import { allowedTabsForRole, canAdministerOrganization } from "./roles.js";
import {
  presetFor,
  settingsToValues,
  statusText,
  testResultText,
  valuesToSettings,
  visibilityFor,
} from "./copernicus-form.js";

const DEVICE_ACTIVITY_THROTTLE_MS = 60 * 1000;
const DEVICE_SESSION_IDLE_MS = 30 * 60 * 1000;
const DEVICE_SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
const AUTH_SESSION_KEYS = [
  "accessToken",
  "refreshToken",
  "user",
  "selectedOrganizationId",
  "deviceSession",
  "deviceSessionLastActivityAt",
];

function isValidDeviceSession(session) {
  return Boolean(
    session &&
    typeof session.id === "string" && session.id.length > 0 &&
    Number.isFinite(Date.parse(session.createdAt)) &&
    Number.isFinite(Date.parse(session.expiresAt)) &&
    Number.isFinite(Date.parse(session.idleExpiresAt)),
  );
}

function deviceSessionExpired(session, lastActivityAt, now = Date.now()) {
  if (!isValidDeviceSession(session)) return true;
  const idleDeadline = Math.min(
    Date.parse(session.idleExpiresAt),
    lastActivityAt ? lastActivityAt + DEVICE_SESSION_IDLE_MS : Infinity,
  );
  const absoluteDeadline = Math.min(
    Date.parse(session.expiresAt),
    Date.parse(session.createdAt) + DEVICE_SESSION_ABSOLUTE_MS,
  );
  return now >= Math.min(absoluteDeadline, idleDeadline);
}

function getOrCreateDeviceId(storage, cryptoApi = globalThis.crypto) {
  const key = "sctracker.deviceId";
  const stored = storage.getItem(key);
  if (stored) return stored;
  let id;
  if (cryptoApi?.randomUUID) {
    id = cryptoApi.randomUUID();
  } else {
    const bytes = new Uint8Array(16);
    if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
    else bytes.forEach((_, index) => { bytes[index] = Math.random() * 256; });
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  storage.setItem(key, id);
  return id;
}

function clearDeviceAuth(storage) {
  for (const key of AUTH_SESSION_KEYS) storage.removeItem(key);
}

const state = {
  accessToken: sessionStorage.getItem("accessToken"),
  refreshToken: sessionStorage.getItem("refreshToken"),
  session: readStoredDeviceSession(),
  user: null,
  organizations: [],
  organizationId: null,
  lastActivityAt: Number(sessionStorage.getItem("deviceSessionLastActivityAt")) || Date.now(),
  auditPage: 1,
};

const $ = (selector) => document.querySelector(selector);
const AUTH_REFRESH_PATH = "api/v1/auth/refresh";
const deviceId = getOrCreateDeviceId(localStorage);
const deviceHeaders = () => ({
  "X-Device-Id": deviceId,
  "X-Device-Platform": "web",
  ...(document.querySelector('meta[name="application-version"]')?.content
    ? { "X-App-Version": document.querySelector('meta[name="application-version"]').content }
    : {}),
});
const apiBaseUrl = resolveApiBaseUrl();
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function normalizePath(path) {
  if (/^https?:\/\//i.test(path)) {
    return new URL(path).pathname.replace(/^\/+/, "");
  }
  return String(path).replace(/^\/+/, "");
}

function buildApiUrl(path) {
  const normalizedPath = normalizePath(path);
  return new URL(normalizedPath, `${apiBaseUrl}/`).toString();
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new URL(value.trim(), window.location.origin);
  return parsed.toString().replace(/\/+$/, "");
}

function resolveApiBaseUrl() {
  const configuredBaseUrl = normalizeBaseUrl(window.TRACEBACKEND_API_BASE_URL) ??
    normalizeBaseUrl(document.querySelector("meta[name='tracebackend-api-base-url']")?.content);
  return configuredBaseUrl ?? window.location.origin;
}

function readStoredDeviceSession() {
  try { return JSON.parse(sessionStorage.getItem("deviceSession") ?? "null"); } catch { return null; }
}

function message(text, error = false) {
  const element = $("#message");
  element.textContent = text;
  element.className = error ? "visible error" : "visible";
  setTimeout(() => { element.className = ""; }, 4000);
}

async function api(path, options = {}, retry = true) {
  const requestUrl = buildApiUrl(path);
  const normalizedPath = normalizePath(path);
  const response = await fetch(requestUrl, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {}),
      ...deviceHeaders(),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401 && retry && state.refreshToken && normalizedPath !== AUTH_REFRESH_PATH) {
    if (body?.error?.code === "SESSION_EXPIRED") {
      logout();
      throw new Error("Die Sitzung ist abgelaufen. Bitte erneut anmelden.");
    }
    const refreshed = await api("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    }, false).catch(() => null);
    if (refreshed) {
      saveTokens(refreshed);
      return api(path, options, false);
    }
  }
  if (response.status === 401 && body?.error?.code === "SESSION_EXPIRED") {
    logout();
    throw new Error("Die Sitzung ist abgelaufen. Bitte erneut anmelden.");
  }
  if (!response.ok || !body?.data) {
    if (response.status === 404 && normalizedPath.startsWith("api/")) {
      throw new Error(`API-Endpunkt nicht gefunden (${requestUrl}). Bitte die Backend-URL prüfen.`);
    }
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return body.data;
}

function saveTokens(tokens) {
  if (!isValidDeviceSession(tokens?.session)) {
    logout();
    throw new Error("Diese Anmeldung erfordert eine neue Sitzung. Bitte erneut anmelden.");
  }
  state.accessToken = tokens.accessToken;
  state.refreshToken = tokens.refreshToken;
  state.session = tokens.session;
  if (!sessionStorage.getItem("deviceSessionLastActivityAt")) {
    state.lastActivityAt = Date.now();
    sessionStorage.setItem("deviceSessionLastActivityAt", String(state.lastActivityAt));
  } else {
    state.lastActivityAt = Number(sessionStorage.getItem("deviceSessionLastActivityAt")) || Date.now();
  }
  sessionStorage.setItem("accessToken", tokens.accessToken);
  sessionStorage.setItem("refreshToken", tokens.refreshToken);
  sessionStorage.setItem("deviceSession", JSON.stringify(tokens.session));
  scheduleSessionExpiry();
}

function logout() {
  clearTimeout(sessionExpiryTimer);
  state.accessToken = null;
  state.refreshToken = null;
  state.session = null;
  state.user = null;
  clearDeviceAuth(sessionStorage);
  $("#workspace").classList.add("hidden");
  $("#logout").classList.add("hidden");
  $("#login-panel").classList.remove("hidden");
}

let sessionExpiryTimer = null;
let lastActivityRequestAt = 0;
let lastProactiveRefreshAt = 0;
let activitySync = null;

function sessionDeadline() {
  if (!isValidDeviceSession(state.session)) return 0;
  return Math.min(
    Date.parse(state.session.expiresAt),
    Date.parse(state.session.createdAt) + DEVICE_SESSION_ABSOLUTE_MS,
    Date.parse(state.session.idleExpiresAt),
    state.lastActivityAt + DEVICE_SESSION_IDLE_MS,
  );
}

function expireSession() {
  if (!state.accessToken) return;
  logout();
  message("Die Sitzung ist abgelaufen. Bitte erneut anmelden.", true);
}

function scheduleSessionExpiry() {
  clearTimeout(sessionExpiryTimer);
  if (!state.accessToken) return;
  const deadline = sessionDeadline();
  if (!deadline) {
    expireSession();
    return;
  }
  sessionExpiryTimer = setTimeout(() => {
    if (deviceSessionExpired(state.session, state.lastActivityAt)) expireSession();
    else scheduleSessionExpiry();
  }, Math.max(0, deadline - Date.now()));
}

function tokenExpiresSoon() {
  try {
    const token = state.accessToken?.split(".")[1];
    if (!token) return false;
    const claims = JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/")));
    return Number(claims.exp) * 1000 <= Date.now() + 5 * 60 * 1000;
  } catch {
    return false;
  }
}

async function syncDeviceActivity() {
  if (activitySync) return activitySync;
  activitySync = (async () => {
    const now = Date.now();
    if (deviceSessionExpired(state.session, state.lastActivityAt, now)) {
      expireSession();
      return;
    }
    if (tokenExpiresSoon() && now - lastProactiveRefreshAt >= DEVICE_ACTIVITY_THROTTLE_MS) {
      lastProactiveRefreshAt = now;
      const refreshed = await api("/api/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: state.refreshToken }),
      }, false).catch(() => null);
      if (!refreshed) {
        expireSession();
        return;
      }
      saveTokens(refreshed);
    }
    if (now - lastActivityRequestAt < DEVICE_ACTIVITY_THROTTLE_MS) return;
    lastActivityRequestAt = now;
    try {
      const response = await fetch(buildApiUrl("/api/v1/auth/activity"), {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${state.accessToken}`,
          ...deviceHeaders(),
          ...(state.organizationId ? { "X-Organization-Id": state.organizationId } : {}),
        },
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 401) {
        if (payload?.error?.code === "SESSION_EXPIRED") {
          expireSession();
        } else {
          const refreshed = await api("/api/v1/auth/refresh", {
            method: "POST",
            body: JSON.stringify({ refreshToken: state.refreshToken }),
          }, false).catch(() => null);
          if (refreshed) saveTokens(refreshed);
          else expireSession();
        }
        return;
      }
      if (!response.ok || !isValidDeviceSession(payload?.data?.session)) return;
      state.session = payload.data.session;
      sessionStorage.setItem("deviceSession", JSON.stringify(state.session));
      scheduleSessionExpiry();
    } catch {
      // Local expiry still applies if the browser is offline.
    }
  })().finally(() => { activitySync = null; });
  return activitySync;
}

function recordDeviceActivity() {
  if (!state.accessToken || document.visibilityState !== "visible") return;
  const now = Date.now();
  if (deviceSessionExpired(state.session, state.lastActivityAt, now)) {
    expireSession();
    return;
  }
  state.lastActivityAt = now;
  sessionStorage.setItem("deviceSessionLastActivityAt", String(now));
  scheduleSessionExpiry();
  void syncDeviceActivity();
}

function checkDeviceSession() {
  if (state.accessToken && deviceSessionExpired(state.session, state.lastActivityAt)) expireSession();
}

async function loadOrganizations() {
  state.organizations = await api("/api/v1/admin/organizations");
  const select = $("#organization-select");
  select.innerHTML = state.organizations
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(item.slug)})</option>`)
    .join("");
  state.organizationId = state.user.organizationId ??
    (state.organizations.some((item) => item.id === state.organizationId)
      ? state.organizationId
      : state.organizations[0]?.id ?? null);
  select.value = state.organizationId ?? "";
  showSelectedOrganization();
  if (state.organizationId) await loadActiveTab();
}

function showSelectedOrganization() {
  const form = $("#organization-edit-form");
  const organization = state.organizations.find((item) => item.id === state.organizationId);
  if (!organization || state.user?.role !== "system_admin") return;
  form.elements.name.value = organization.name;
  form.elements.active.checked = organization.active;
}

function configureRoleUi() {
  const allowed = new Set(allowedTabsForRole(state.user?.role));
  const buttons = [...document.querySelectorAll(".tabs button")];
  buttons.forEach((button) => {
    button.classList.toggle("hidden", !allowed.has(button.dataset.tab));
    button.classList.remove("active");
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  document.querySelectorAll(".system-only").forEach((element) =>
    element.classList.toggle("hidden", state.user?.role !== "system_admin"));
  document.querySelectorAll(".admin-only").forEach((element) =>
    element.classList.toggle("hidden", !canAdministerOrganization(state.user?.role)));
  const first = buttons.find((button) => allowed.has(button.dataset.tab));
  if (!first) return false;
  first.classList.add("active");
  $(`#tab-${first.dataset.tab}`).classList.remove("hidden");
  return true;
}

function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table></div>`;
}

async function loadUsers() {
  const users = await api(`/api/v1/admin/organizations/${state.organizationId}/users`);
  $("#users").innerHTML = table(["E-Mail", "Name", "Rolle", "Aktiv", "Aktion"], users.map((user) =>
    `<tr><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.displayName)}</td>` +
    `<td><select data-user-role="${user.id}">${["org_admin", "reviewer", "field_agent", "auditor"]
      .map((role) => `<option ${role === user.role ? "selected" : ""}>${role}</option>`).join("")}</select></td>` +
    `<td>${user.active ? "Ja" : "Nein"}</td><td><button data-user-toggle="${user.id}" data-active="${user.active}">` +
    `${user.active ? "Deaktivieren" : "Aktivieren"}</button></td></tr>`));
  await loadDeviceAudit().catch((error) => { $("#device-audit-status").textContent = error.message; });
}

function deviceAuditQuery(format = "json") {
  const form = $("#device-audit-filters");
  const values = new FormData(form);
  const params = new URLSearchParams();
  for (const name of ["userId", "deviceId", "sessionId", "action", "platform", "outcome", "search"]) {
    const value = String(values.get(name) ?? "").trim();
    if (value) params.set(name, value);
  }
  for (const name of ["from", "to"]) {
    const value = String(values.get(name) ?? "");
    if (value) params.set(name, new Date(value).toISOString());
  }
  if (state.user?.role === "system_admin" && state.organizationId) {
    params.set("organizationId", state.organizationId);
  }
  params.set("page", String(state.auditPage));
  params.set("limit", String(Number(values.get("limit")) || 50));
  if (format !== "json") params.set("format", format);
  return params;
}

function auditTime(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function renderAuditSummary(summary = {}) {
  const cards = [
    ["Ereignisse", summary.events],
    ["Fehler", summary.errors],
    ["Fehlerquote", `${Number(summary.errorRate ?? 0).toFixed(1)}%`],
    ["Geräte", summary.devices],
    ["Sitzungen", summary.sessions],
    ["Aktive Sitzungen", summary.activeSessions],
  ];
  $("#device-audit-summary").innerHTML = cards.map(([label, value]) =>
    `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong></article>`).join("");
}

async function loadDeviceAudit() {
  if (!state.organizationId) return;
  const params = deviceAuditQuery();
  const result = await api(`/api/v1/admin/users/device-audit?${params}`);
  const events = result.events ?? [];
  const sessions = result.sessions ?? [];
  renderAuditSummary(result.summary);
  $("#device-audit-sessions").innerHTML = table(
    ["Status", "Benutzer", "Plattform / App", "Gerät", "Sitzung", "Zuletzt aktiv", "Ablauf", "Ende"],
    sessions.map((session) =>
      `<tr><td>${escapeHtml(session.status)}${session.endReason ? `<br><small>${escapeHtml(session.endReason)}</small>` : ""}</td>` +
      `<td>${escapeHtml(session.userName)}<br><small>${escapeHtml(session.email)}</small></td>` +
      `<td>${escapeHtml(session.platform)}<br><small>${escapeHtml(session.appVersion ?? "—")}</small></td>` +
      `<td><code>${escapeHtml(session.deviceId)}</code></td><td><code>${escapeHtml(session.id)}</code></td>` +
      `<td>${escapeHtml(auditTime(session.lastActiveAt))}</td><td>${escapeHtml(auditTime(session.expiresAt))}</td>` +
      `<td>${escapeHtml(auditTime(session.endedAt))}</td></tr>`),
  );
  $("#device-audit-timeline").innerHTML = table(
    ["Tag", "Ereignisse", "Fehler"],
    (result.timeline ?? []).map((day) =>
      `<tr><td>${escapeHtml(day.day)}</td><td>${escapeHtml(day.events)}</td><td>${escapeHtml(day.errors)}</td></tr>`),
  );
  $("#device-audit-events").innerHTML = table(
    ["Zeit", "Benutzer", "Aktion", "Gerät / Sitzung", "Plattform", "Anfrage", "Ergebnis"],
    events.map((event) =>
      `<tr><td>${escapeHtml(auditTime(event.createdAt))}</td>` +
      `<td>${escapeHtml(event.userName)}<br><small>${escapeHtml(event.email)}</small></td>` +
      `<td>${escapeHtml(event.action)}</td>` +
      `<td><small>Gerät: ${escapeHtml(event.deviceId)}<br>Sitzung: ${escapeHtml(event.sessionId)}</small></td>` +
      `<td>${escapeHtml(event.platform)}<br><small>${escapeHtml(event.appVersion ?? "—")}</small></td>` +
      `<td>${escapeHtml(event.method)} ${escapeHtml(event.path)}</td>` +
      `<td>${escapeHtml(event.statusCode ?? "—")}</td></tr>`),
  );
  const page = Number(result.page ?? state.auditPage);
  const limit = Number(result.limit ?? 50);
  const total = Number(result.total ?? 0);
  $("#device-audit-page").textContent = `Seite ${page} · ${total} Ereignisse`;
  $("#device-audit-previous").disabled = page <= 1;
  $("#device-audit-next").disabled = page * limit >= total;
  $("#device-audit-status").textContent = "";
}

async function downloadDeviceAuditCsv() {
  const params = deviceAuditQuery("csv");
  const path = `/api/v1/admin/users/device-audit?${params}`;
  let response = await fetch(buildApiUrl(path), {
    headers: {
      Accept: "text/csv",
      ...(state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {}),
      ...deviceHeaders(),
    },
  });
  if (response.status === 401) {
    const body = await response.clone().json().catch(() => null);
    if (body?.error?.code === "SESSION_EXPIRED") {
      logout();
    } else {
      const refreshed = await api("/api/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: state.refreshToken }),
      }, false).catch(() => null);
      if (refreshed) {
        saveTokens(refreshed);
        response = await fetch(buildApiUrl(path), {
          headers: {
            Accept: "text/csv",
            Authorization: `Bearer ${state.accessToken}`,
            ...deviceHeaders(),
          },
        });
      }
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (body?.error?.code === "SESSION_EXPIRED") logout();
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "device-audit.csv";
  link.click();
  URL.revokeObjectURL(objectUrl);
}

async function loadConfig() {
  const organizationId = state.organizationId;
  const config = await api(`/api/v1/admin/organizations/${organizationId}/config`);
  if (state.organizationId !== organizationId) return;
  const form = $("#config-form");
  form.satelliteEnabled.checked = config.satelliteEnabled;
  form.satelliteComparisonEnabled.checked = config.satelliteComparisonEnabled;
  form.satelliteEndpoint.value = config.satelliteEndpoint ?? "";
  form.satelliteApiKey.placeholder = config.hasSatelliteApiKey ? "Gespeichert (wird nicht angezeigt)" : "";
  form.evidencePackEnabled.checked = config.evidencePackEnabled;
  form.mode.value = config.eu.mode;
  form.endpoint.value = config.eu.endpoint ?? "";
  form.timeoutMs.value = config.eu.timeoutMs;
  form.username.placeholder = config.eu.hasUsername ? "Gespeichert (wird nicht angezeigt)" : "";
  form.euPassword.placeholder = config.eu.hasPassword ? "Gespeichert (wird nicht angezeigt)" : "";
  form.clientId.placeholder = config.eu.hasClientId ? "Gespeichert (wird nicht angezeigt)" : "";
  await loadGoogleMaps();
}

function enableGoogleMapsForm(enabled) {
  for (const element of $("#google-maps-form").elements) element.disabled = !enabled;
}

function resetGoogleMapsForm() {
  $("#google-maps-form").reset();
  enableGoogleMapsForm(false);
  $("#google-maps-status").textContent = "";
}

function showGoogleMapsConfig(config) {
  const form = $("#google-maps-form");
  form.reset();
  form.elements.enabled.checked = config.enabled;
  form.elements.apiKey.placeholder = config.hasApiKey ? "Gespeichert (wird nicht angezeigt)" : "Noch nicht hinterlegt";
  $("#google-maps-status").textContent = config.enabled ? "Google Maps ist aktiv." : "Google Maps ist deaktiviert.";
  enableGoogleMapsForm(true);
}

async function loadGoogleMaps() {
  const organizationId = state.organizationId;
  resetGoogleMapsForm();
  $("#google-maps-status").textContent = "Google-Maps-Konfiguration wird geladen …";
  try {
    const config = await api(`/api/v1/admin/organizations/${organizationId}/google-maps`);
    if (state.organizationId === organizationId) showGoogleMapsConfig(config);
  } catch (error) {
    if (state.organizationId === organizationId) $("#google-maps-status").textContent = error.message;
    throw error;
  }
}

const copernicusPath = () => `/api/v1/admin/organizations/${state.organizationId}/copernicus-process`;

function readCopernicusValues(form) {
  const values = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    values[element.name] = element.type === "checkbox" ? element.checked : element.value;
  }
  return values;
}

function writeCopernicusValues(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const element = form.elements[name];
    if (!element) continue;
    if (element.type === "checkbox") element.checked = Boolean(value);
    else element.value = value;
  }
}

function applyCopernicusVisibility(form) {
  const values = readCopernicusValues(form);
  const visibility = visibilityFor(values);
  $("#s1-options").classList.toggle("hidden", !visibility.s1Options);
  $("#evalscript-field").classList.toggle("hidden", !visibility.evalscript);
  form.querySelectorAll("[data-optical-only]").forEach((element) => {
    if (element.tagName === "OPTION") element.hidden = !visibility.optical;
    else element.classList.toggle("hidden", !visibility.optical);
  });
  if (!visibility.optical && form.elements.mosaickingOrder.value === "leastCC") {
    form.elements.mosaickingOrder.value = "mostRecent";
  }
}

async function loadCopernicus() {
  const config = await api(copernicusPath());
  const form = $("#copernicus-form");
  form.elements.enabled.checked = config.enabled;
  writeCopernicusValues(form, settingsToValues(config.settings));
  form.elements.clientId.value = "";
  form.elements.clientSecret.value = "";
  form.elements.clearClientId.checked = form.elements.clearClientSecret.checked = false;
  form.elements.clientId.placeholder = config.hasClientId ? "Gespeichert (wird nicht angezeigt)" : "";
  form.elements.clientSecret.placeholder = config.hasClientSecret ? "Gespeichert (wird nicht angezeigt)" : "";
  $("#copernicus-status").textContent = statusText(config);
  $("#copernicus-test-result").textContent = "";
  applyCopernicusVisibility(form);
}
async function loadGeofences() {
  const items = await api(`/api/v1/admin/organizations/${state.organizationId}/geofences`);
  const canEdit = canAdministerOrganization(state.user?.role);
  $("#geofences").innerHTML = table(["Name", "Status", "GeoJSON", "Aktion"], items.map((item) =>
    `<tr><td>${escapeHtml(item.name)}</td><td>${item.active ? "Aktiv" : "Inaktiv"}</td>` +
    `<td><code>${escapeHtml(JSON.stringify(item.polygon))}</code></td>` +
    `<td>${canEdit ? `<button data-geofence-toggle="${item.id}" data-active="${item.active}">${item.active ? "Deaktivieren" : "Aktivieren"}</button>` : "Nur Lesen"}</td></tr>`));
}

async function loadReviews() {
  const items = await api(`/api/v1/admin/organizations/${state.organizationId}/reviews`);
  $("#reviews").innerHTML = table(["Typ", "Objekt", "Status", "Grund", "Aktion"], items.map((item) =>
    `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.subjectId)}</td>` +
    `<td><span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>` +
    `<td>${escapeHtml(item.reason)}</td><td class="actions">${item.status === "pending" ?
      `<button data-review="${item.type}:${item.id}:approved">Freigeben</button>` +
      `<button class="danger" data-review="${item.type}:${item.id}:rejected">Ablehnen</button>` : ""}</td></tr>`));
}

async function loadAudit() {
  const items = await api(`/api/v1/admin/organizations/${state.organizationId}/audit-logs?limit=100`);
  $("#audit").innerHTML = table(["Zeit", "Aktion", "Ressource", "Details"], items.map((item) =>
    `<tr><td>${escapeHtml(new Date(item.createdAt).toLocaleString())}</td>` +
    `<td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.resourceType)} ${escapeHtml(item.resourceId ?? "")}</td>` +
    `<td><code>${escapeHtml(JSON.stringify(item.details))}</code></td></tr>`));
}

async function loadReconciliation() {
  const items = await api(`/api/v1/admin/organizations/${state.organizationId}/dds-reconciliation`);
  $("#reconciliation").innerHTML = table(
    ["DDS", "Status", "Phase", "Fehler", "Aktualisiert", "Aktion"],
    items.map((item) =>
      `<tr><td>${escapeHtml(item.operationId)}<br><small>${escapeHtml(item.subjectId)}</small></td>` +
      `<td><span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>` +
      `<td>${escapeHtml(item.operationPhase)}</td><td>${escapeHtml(item.errorCode ?? "")}</td>` +
      `<td>${escapeHtml(new Date(item.updatedAt).toLocaleString())}</td><td class="actions">` +
      `<button data-reconcile="${item.id}:confirm_submitted">Extern bestätigt</button>` +
      `<button class="danger" data-reconcile="${item.id}:reset_not_submitted">Nicht eingereicht</button></td></tr>`),
  );
}

const loaders = {
  users: loadUsers,
  config: loadConfig,
  copernicus: loadCopernicus,
  geofences: loadGeofences,
  reviews: loadReviews,
  reconciliation: loadReconciliation,
  audit: loadAudit,
};
async function loadActiveTab() {
  const active = $(".tabs button.active")?.dataset.tab;
  if (!active) return;
  try { await loaders[active](); } catch (error) { message(error.message, true); }
}

async function initialize() {
  if (!state.accessToken) return;
  if (!isValidDeviceSession(state.session)) {
    logout();
    return;
  }
  if (deviceSessionExpired(state.session, state.lastActivityAt)) {
    expireSession();
    return;
  }
  scheduleSessionExpiry();
  try {
    state.user = await api("/api/v1/auth/me");
    $("#login-panel").classList.add("hidden");
    $("#workspace").classList.remove("hidden");
    $("#logout").classList.remove("hidden");
    if (!configureRoleUi()) {
      logout();
      message("Diese Rolle besitzt keinen Zugriff auf den Adminbereich.", true);
      return;
    }
    await loadOrganizations();
  } catch {
    logout();
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        ...(form.get("organizationSlug") ? { organizationSlug: form.get("organizationSlug") } : {}),
      }),
    });
    saveTokens(result);
    await initialize();
  } catch (error) { message(error.message, true); }
});

$("#logout").addEventListener("click", async () => {
  if (state.refreshToken) {
    await api("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    }).catch(() => null);
  }
  logout();
});

$("#device-audit-filters").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.auditPage = 1;
  try { await loadDeviceAudit(); } catch (error) {
    $("#device-audit-status").textContent = error.message;
  }
});

$("#device-audit-csv").addEventListener("click", async () => {
  try { await downloadDeviceAuditCsv(); } catch (error) {
    $("#device-audit-status").textContent = error.message;
  }
});

$("#device-audit-previous").addEventListener("click", async () => {
  state.auditPage = Math.max(1, state.auditPage - 1);
  try { await loadDeviceAudit(); } catch (error) {
    $("#device-audit-status").textContent = error.message;
  }
});

$("#device-audit-next").addEventListener("click", async () => {
  state.auditPage += 1;
  try { await loadDeviceAudit(); } catch (error) {
    $("#device-audit-status").textContent = error.message;
  }
});

$("#organization-select").addEventListener("change", async (event) => {
  state.organizationId = event.target.value;
  state.auditPage = 1;
  resetGoogleMapsForm();
  showSelectedOrganization();
  await loadActiveTab();
});

$("#organization-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), slug: form.get("slug") }),
    });
    event.currentTarget.reset();
    await loadOrganizations();
    message("Organisation angelegt.");
  } catch (error) { message(error.message, true); }
});

$("#organization-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: event.currentTarget.elements.name.value,
        active: event.currentTarget.elements.active.checked,
      }),
    });
    await loadOrganizations();
    message("Organisation gespeichert.");
  } catch (error) { message(error.message, true); }
});

$("#user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/users`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form)),
    });
    event.currentTarget.reset();
    await loadUsers();
    message("Benutzer angelegt.");
  } catch (error) { message(error.message, true); }
});

$("#users").addEventListener("change", async (event) => {
  if (!event.target.dataset.userRole) return;
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/users/${event.target.dataset.userRole}`, {
      method: "PATCH",
      body: JSON.stringify({ role: event.target.value }),
    });
    message("Rolle aktualisiert.");
  } catch (error) { message(error.message, true); await loadUsers(); }
});

$("#users").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-user-toggle]");
  if (!button) return;
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/users/${button.dataset.userToggle}`, {
      method: "PATCH",
      body: JSON.stringify({ active: button.dataset.active !== "true" }),
    });
    await loadUsers();
  } catch (error) { message(error.message, true); }
});

$("#google-maps-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const organizationId = state.organizationId;
  const body = {
    enabled: form.elements.enabled.checked,
    apiKey: form.elements.clearApiKey.checked ? null : form.elements.apiKey.value.trim() || undefined,
  };
  enableGoogleMapsForm(false);
  try {
    const config = await api(`/api/v1/admin/organizations/${organizationId}/google-maps`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (state.organizationId === organizationId) showGoogleMapsConfig(config);
    message("Google-Maps-Konfiguration gespeichert.");
  } catch (error) {
    if (state.organizationId === organizationId) $("#google-maps-status").textContent = error.message;
    message(error.message, true);
  } finally {
    if (state.organizationId === organizationId) enableGoogleMapsForm(true);
  }
});

$("#config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const secret = (field, clear) => clear.checked ? null : field.value || undefined;
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/config`, {
      method: "PUT",
      body: JSON.stringify({
        satelliteEnabled: form.satelliteEnabled.checked,
        satelliteComparisonEnabled: form.satelliteComparisonEnabled.checked,
        satelliteEndpoint: form.satelliteEndpoint.value || null,
        satelliteApiKey: secret(form.satelliteApiKey, form.clearSatelliteApiKey),
        evidencePackEnabled: form.evidencePackEnabled.checked,
        eu: {
          mode: form.mode.value,
          endpoint: form.endpoint.value || null,
          timeoutMs: Number(form.timeoutMs.value),
          username: secret(form.username, form.clearUsername),
          password: secret(form.euPassword, form.clearPassword),
          clientId: secret(form.clientId, form.clearClientId),
        },
        extra: {},
      }),
    });
    form.username.value = form.euPassword.value = form.clientId.value = form.satelliteApiKey.value = "";
    form.clearUsername.checked = form.clearPassword.checked =
      form.clearClientId.checked = form.clearSatelliteApiKey.checked = false;
    await loadConfig();
    message("Konfiguration gespeichert.");
  } catch (error) { message(error.message, true); }
});

{
  const form = $("#copernicus-form");
  form.addEventListener("change", (event) => {
    if (event.target.name === "dataset") {
      form.elements.preset.value = presetFor(event.target.value, form.elements.preset.value);
    }
    applyCopernicusVisibility(form);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readCopernicusValues(form);
    const secret = (field, clear) => clear ? null : field.trim() || undefined;
    try {
      const config = await api(copernicusPath(), {
        method: "PUT",
        body: JSON.stringify({
          enabled: values.enabled,
          clientId: secret(values.clientId, values.clearClientId),
          clientSecret: secret(values.clientSecret, values.clearClientSecret),
          settings: valuesToSettings(values),
        }),
      });
      await loadCopernicus();
      $("#copernicus-status").textContent = statusText(config);
      message("Copernicus-Konfiguration gespeichert.");
    } catch (error) { message(error.message, true); }
  });

  $("#copernicus-test").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const output = $("#copernicus-test-result");
    button.disabled = true;
    output.textContent = "Verbindung wird getestet…";
    try {
      const result = await api(`${copernicusPath()}/test`, { method: "POST" });
      output.textContent = testResultText(result);
      message(result.ok ? "Verbindung erfolgreich." : "Verbindungstest fehlgeschlagen.", !result.ok);
    } catch (error) {
      output.textContent = error.message;
      message(error.message, true);
    } finally { button.disabled = false; }
  });
}
$("#geofence-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/geofences`, {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), polygon: JSON.parse(form.get("polygon")), active: true }),
    });
    await loadGeofences();
    message("Geofence angelegt.");
  } catch (error) { message(error.message, true); }
});

$("#geofences").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-geofence-toggle]");
  if (!button) return;
  try {
    await api(`/api/v1/admin/organizations/${state.organizationId}/geofences/${button.dataset.geofenceToggle}`, {
      method: "PATCH",
      body: JSON.stringify({ active: button.dataset.active !== "true" }),
    });
    await loadGeofences();
  } catch (error) { message(error.message, true); }
});

$("#reviews").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-review]");
  if (!button) return;
  const [type, id, decision] = button.dataset.review.split(":");
  try {
    await api(`/api/v1/admin/reviews/${type}/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, note: "" }),
    });
    await loadReviews();
    message("Review aktualisiert.");
  } catch (error) { message(error.message, true); }
});

$("#reconciliation").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-reconcile]");
  if (!button) return;
  const [actionId, decision] = button.dataset.reconcile.split(":");
  const note = window.prompt("Begründung der Reconciliation:");
  if (!note) return;
  const externalReference = decision === "confirm_submitted"
    ? window.prompt("Bestätigte externe DDS-Referenz:")
    : undefined;
  if (decision === "confirm_submitted" && !externalReference) return;
  try {
    await api(`/api/v1/admin/dds-actions/${actionId}/reconcile`, {
      method: "POST",
      body: JSON.stringify({ decision, note, externalReference }),
    });
    await loadReconciliation();
    message("DDS-Reconciliation gespeichert.");
  } catch (error) { message(error.message, true); }
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", async () => {
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((item) => item.classList.add("hidden"));
    button.classList.add("active");
    $(`#tab-${button.dataset.tab}`).classList.remove("hidden");
    await loadActiveTab();
  });
});

document.addEventListener("pointerdown", recordDeviceActivity, { passive: true });
document.addEventListener("keydown", recordDeviceActivity);
document.addEventListener("touchstart", recordDeviceActivity, { passive: true });
document.addEventListener("wheel", recordDeviceActivity, { passive: true });
document.addEventListener("input", recordDeviceActivity);
document.addEventListener("change", recordDeviceActivity);
document.addEventListener("visibilitychange", checkDeviceSession);
window.addEventListener("focus", checkDeviceSession);

void initialize();
