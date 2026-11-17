import { clearDeviceAuth } from "./device-session.mjs?v=1";

export function initPasswordRecovery({ t, onReset }) {
  const login = document.querySelector("#tracehub-login-form");
  login.insertAdjacentHTML("afterend", `
    <button type="button" class="secondary-button full" id="forgot-password" data-i18n="prod.reset.forgot"></button>
    <form id="forgot-password-form" hidden>
      <h2 data-i18n="prod.reset.forgot"></h2>
      <label><span data-i18n="prod.login.email"></span><input name="email" type="email" autocomplete="username" required></label>
      <label><span data-i18n="prod.login.slug"></span><input name="organizationSlug" autocomplete="organization"></label>
      <button type="submit" class="primary-button full" data-i18n="prod.reset.request"></button>
      <button type="button" class="secondary-button full" data-reset-back data-i18n="prod.reset.back"></button>
    </form>
    <form id="reset-password-form" hidden>
      <h2 data-i18n="prod.reset.title"></h2>
      <label><span data-i18n="prod.reset.password"></span><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required></label>
      <label><span data-i18n="prod.reset.confirm"></span><input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required></label>
      <button type="submit" class="primary-button full" data-i18n="prod.reset.title"></button>
      <button type="button" class="secondary-button full" data-reset-back data-i18n="prod.reset.back"></button>
    </form>`);
  const forgot = document.querySelector("#forgot-password-form");
  const reset = document.querySelector("#reset-password-form");
  const toggle = document.querySelector("#forgot-password");
  const status = document.querySelector("#auth-status");
  let resetToken = null;
  function show(mode) {
    login.hidden = mode !== "login";
    toggle.hidden = mode !== "login";
    forgot.hidden = mode !== "forgot";
    reset.hidden = mode !== "reset";
    status.textContent = "";
  }
  async function post(path, body) {
    const response = await fetch(`/api/v1/auth/${path}`, { method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error?.message || t("prod.common.loadFailed"));
  }
  toggle.addEventListener("click", () => {
    forgot.elements.email.value = login.elements.email.value;
    forgot.elements.organizationSlug.value = login.elements.organizationSlug.value;
    show("forgot");
  });
  document.querySelectorAll("[data-reset-back]").forEach((button) => button.addEventListener("click", () => {
    resetToken = null;
    reset.reset();
    show("login");
  }));
  forgot.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = forgot.querySelector('[type="submit"]');
    button.disabled = true;
    status.textContent = "";
    try {
      const slug = forgot.elements.organizationSlug.value.trim();
      await post("forgot-password", { email: forgot.elements.email.value,
        ...(slug ? { organizationSlug: slug } : {}) });
      status.textContent = t("prod.reset.sent");
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  reset.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (reset.elements.password.value !== reset.elements.confirmation.value) {
      status.textContent = t("prod.reset.mismatch"); return;
    }
    const button = reset.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await post("reset-password", { token: resetToken, password: reset.elements.password.value });
      resetToken = null;
      reset.reset();
      clearDeviceAuth(sessionStorage);
      show("login");
      status.textContent = t("prod.reset.success");
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  function readResetLink() {
    const fragment = location.hash.slice(1);
    if (!fragment.startsWith("reset-password?")) return;
    resetToken = new URLSearchParams(fragment.slice("reset-password?".length)).get("token");
    history.replaceState(null, "", location.pathname + location.search);
    if (resetToken) {
      clearDeviceAuth(sessionStorage);
      onReset();
      show("reset");
    }
  }
  window.addEventListener("hashchange", readResetLink);
  readResetLink();
  return { isResetting: () => Boolean(resetToken) };
}
