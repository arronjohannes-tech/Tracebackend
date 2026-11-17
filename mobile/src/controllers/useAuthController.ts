import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import {
  activateAccount,
  ApiError,
  configureApiSession,
  login as apiLogin,
  logout as apiLogout,
  refreshSession,
  selectOrganization as apiSelectOrganization,
  configureDevice,
  enforceSessionDeadline,
  recordSessionActivity,
} from "../api";
import type { AuthSession } from "../domain";
import { clearSession, loadDeviceId, loadSession, saveSession } from "../storage";
import appConfig from "../../app.json";
import { parseActivationLink } from "../onboarding";

type Activation = {
  token: string | null;
  status: "clearing" | "ready" | "invalid" | "failed" | "loginFailed" | "storageError";
};

export function useAuthController() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activation, setActivation] = useState<Activation | null>(null);
  const generation = useRef(0);
  const activationRef = useRef<Activation | null>(null);
  const working = useRef(false);

  useEffect(() => {
    let active = true;
    let writes = Promise.resolve();
    const persist = async (next: AuthSession | null) => {
      if (!active) return;
      setSession(next);
      const write = writes.catch(() => undefined).then(() => next ? saveSession(next) : clearSession());
      writes = write;
      await write;
    };
    configureApiSession(null, persist);
    const acceptLink = (url: string | null) => {
      if (!active || !url) return;
      const link = parseActivationLink(url);
      if (!link) return;
      const current = ++generation.current;
      const next: Activation = { token: link.token, status: "clearing" };
      activationRef.current = next;
      setActivation(next);
      setError(null);
      setBusy(false);
      working.current = false;
      // Invalidate in-flight refresh/login and remove the old principal before showing activation.
      configureApiSession(null, persist);
      setSession(null);
      if (Platform.OS === "web") {
        globalThis.history?.replaceState(null, "", globalThis.location.pathname);
      }
      void persist(null).then(() => {
        if (!active || generation.current !== current) return;
        const cleared: Activation = { token: link.token, status: link.token ? "ready" : "invalid" };
        activationRef.current = cleared;
        setActivation(cleared);
      }).catch(() => {
        if (!active || generation.current !== current) return;
        const failed: Activation = { token: null, status: "storageError" };
        activationRef.current = failed;
        setActivation(failed);
      });
    };
    const subscription = Linking.addEventListener("url", ({ url }) => acceptLink(url));
    const webLink = () => acceptLink(globalThis.location.href);
    if (Platform.OS === "web") {
      globalThis.addEventListener("hashchange", webLink);
      globalThis.addEventListener("popstate", webLink);
    }
    void (async () => {
      const initial = generation.current;
      const deviceId = await loadDeviceId();
      configureDevice(deviceId, Platform.OS, appConfig.expo.version);
      const url = await Linking.getInitialURL();
      if (!active || generation.current !== initial) return;
      acceptLink(Platform.OS === "web" ? globalThis.location.href : url);
      if (activationRef.current) return;
      const stored = await loadSession();
      if (!active || generation.current !== initial) return;
      configureApiSession(stored, persist);
      setSession(stored);
      await enforceSessionDeadline();
      if (stored && Date.parse(stored.accessTokenExpiresAt) <= Date.now() + 15_000) {
        await refreshSession();
      }
    })()
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      generation.current++;
      subscription.remove();
      if (Platform.OS === "web") {
        globalThis.removeEventListener("hashchange", webLink);
        globalThis.removeEventListener("popstate", webLink);
      }
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const check = () => {
      void enforceSessionDeadline().catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)));
    };
    const timer = setInterval(check, 5000);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    const activity = () => {
      if (Platform.OS === "web" && globalThis.document?.visibilityState !== "visible") return;
      if (AppState.currentState === "active" || Platform.OS === "web") recordActivity();
    };
    if (Platform.OS === "web") {
      globalThis.addEventListener("pointerdown", activity);
      globalThis.addEventListener("keydown", activity);
      globalThis.addEventListener("scroll", activity, true);
    }
    return () => {
      clearInterval(timer);
      subscription.remove();
      if (Platform.OS === "web") {
        globalThis.removeEventListener("pointerdown", activity);
        globalThis.removeEventListener("keydown", activity);
        globalThis.removeEventListener("scroll", activity, true);
      }
    };
  }, [session?.session?.id]);

  function recordActivity() {
    void recordSessionActivity().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)));
  }

  function dismissActivation() {
    if (working.current || activationRef.current?.status === "clearing" ||
        activationRef.current?.status === "storageError") return;
    generation.current++;
    activationRef.current = null;
    setActivation(null);
    setError(null);
  }

  async function activate(password: string) {
    const current = activationRef.current;
    if (!current?.token || working.current ||
        (current.status !== "ready" && current.status !== "failed")) return;
    const version = generation.current;
    working.current = true;
    setBusy(true);
    const show = (next: Activation | null) => {
      activationRef.current = next;
      setActivation(next);
    };
    let activated = false;
    try {
      const result = await activateAccount(current.token, password);
      if (generation.current !== version) return;
      activated = true;
      show({ token: null, status: "ready" });
      if (!result.email) throw new Error("Missing activation email");
      await apiLogin(result.email, password);
      if (generation.current === version) show(null);
    } catch (reason) {
      if (generation.current !== version) return;
      show({
        token: activated ? null : current.token,
        status: activated ? "loginFailed" :
          reason instanceof ApiError && reason.code === "INVALID_ACTIVATION_TOKEN" ? "invalid" : "failed",
      });
      if (reason instanceof ApiError && reason.code === "INVALID_ACTIVATION_TOKEN") {
        show({ token: null, status: "invalid" });
      }
    } finally {
      if (generation.current === version) {
        working.current = false;
        setBusy(false);
      }
    }
  }

  async function login(email: string, password: string, organizationSlug?: string) {
    setBusy(true);
    setError(null);
    try {
      await apiLogin(email.trim(), password, organizationSlug?.trim() || undefined);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await apiLogout();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function selectOrganization(organizationId: string) {
    setBusy(true);
    setError(null);
    try {
      await apiSelectOrganization(organizationId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  return { session, ready, busy, error, login, logout, selectOrganization, activation, activate, dismissActivation, recordActivity };
}
