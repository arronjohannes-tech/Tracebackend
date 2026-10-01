import { calculateCompletion, validateMassBalance } from "./src/domain.mjs?v=1";
import {
  SUPPORTED_LANGUAGES,
  applyTranslations,
  translate,
} from "./src/i18n.mjs?v=1";

const completion = calculateCompletion({
  supplier: true,
  plots: true,
  lineage: true,
  evidence: true,
  legalReview: false,
  geoReview: true,
  declaration: true,
  approval: false,
  product: true,
});

const balance = validateMassBalance(
  [{ quantityKg: 19240 }],
  [{ quantityKg: 18500 }, { quantityKg: 740 }],
);

const views = [...document.querySelectorAll(".view")];
const navLinks = [...document.querySelectorAll(".nav-link")];
const pageTitle = document.querySelector("#page-title");
const toast = document.querySelector("#toast");
const languageButtons = [...document.querySelectorAll("[data-language]")];
const accountToggle = document.querySelector("#account-toggle");
const accountDropdown = document.querySelector("#account-dropdown");
const profileDialog = document.querySelector("#profile-dialog");
const inviteSupplierDialog = document.querySelector("#invite-supplier-dialog");
const inviteSupplierForm = document.querySelector("#invite-supplier-form");
const layoutToggle = document.querySelector("#layout-toggle");
const layoutLabel = document.querySelector("#layout-label");
const authGate = document.querySelector("#auth-gate");
const appShell = document.querySelector("#app-shell");
const loginForm = document.querySelector("#tracehub-login-form");
const authStatus = document.querySelector("#auth-status");
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
let dashboardData = null;
let toastTimer;
let activeLanguage = getInitialLanguage();

function getInitialLanguage() {
  const stored = localStorage.getItem("sctracker.language");
  if (SUPPORTED_LANGUAGES.includes(stored)) {
    return stored;
  }

  const browserLanguage = navigator.language.toLowerCase();
  if (browserLanguage.startsWith("am")) {
    return "am";
  }
  if (browserLanguage.startsWith("en")) {
    return "en";
  }
  return "de";
}

function renderDynamicContent() {
  if (dashboardData) {
    renderLiveDashboard(dashboardData);
    return;
  }
  const t = (key) => translate(activeLanguage, key);
  const lineage = [
    {
      type: t("lineage.sourceLots"),
      title: "SL-041 · SL-044 · SL-052",
      detail: t("lineage.rawCoffee"),
    },
    {
      type: t("lineage.processing"),
      title: "Dry Mill DM-2026-88",
      detail: t("lineage.loss"),
    },
    {
      type: t("lineage.exportBatch"),
      title: "B-2026-091",
      detail: t("lineage.released"),
    },
    {
      type: t("lineage.shipment"),
      title: "IMP-2026-0142",
      detail: t("lineage.allocated"),
    },
  ];

  const riskSignals = [
    {
      label: t("signal.completeness"),
      score: "82%",
      detail: t("signal.missingEvidence"),
      warning: true,
    },
    {
      label: t("signal.geoQuality"),
      score: "94%",
      detail: t("signal.openPolygon"),
      warning: false,
    },
    {
      label: t("signal.deforestation"),
      score: t("signal.low"),
      detail: t("signal.eoAnalysis"),
      warning: false,
    },
    {
      label: t("signal.legality"),
      score: t("signal.review"),
      detail: t("signal.documentExpires"),
      warning: true,
    },
    {
      label: t("signal.traceability"),
      score: "99%",
      detail: t("signal.quantityCase"),
      warning: true,
    },
  ];

  document.querySelector("#completion-score").textContent = `${completion}%`;
  document.querySelector("#lineage").innerHTML = lineage
    .map(
      (node) => `
        <div class="lineage-node">
          <small>${node.type}</small>
          <strong>${node.title}</strong>
          <em>${node.detail}</em>
        </div>
      `,
    )
    .join("");

  document.querySelector("#risk-grid").innerHTML = riskSignals
    .map(
      (signal) => `
        <article class="risk-card ${signal.warning ? "warning" : ""}">
          <small>${signal.label}</small>
          <strong>${signal.score}</strong>
          <small>${signal.detail}</small>
        </article>
      `,
    )
    .join("");
}

function setAuthMessage(text = "") {
  if (authStatus) authStatus.textContent = text;
}

function currentAccessToken() {
  return sessionStorage.getItem("accessToken");
}

function selectedOrganizationId() {
  return sessionStorage.getItem("selectedOrganizationId");
}

function saveSession(payload) {
  sessionStorage.setItem("accessToken", payload.accessToken);
  sessionStorage.setItem("refreshToken", payload.refreshToken);
  if (payload.selectedOrganizationId) sessionStorage.setItem("selectedOrganizationId", payload.selectedOrganizationId);
}

async function refreshSession() {
  const refreshToken = sessionStorage.getItem("refreshToken");
  if (!refreshToken) return false;
  const response = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) return false;
  saveSession((await response.json()).data);
  return true;
}

async function dashboardRequest() {
  const headers = {
    Accept: "application/json",
    ...(currentAccessToken() ? { Authorization: `Bearer ${currentAccessToken()}` } : {}),
    ...(selectedOrganizationId() ? { "X-Organization-Id": selectedOrganizationId() } : {}),
  };
  let response = await fetch("/api/v1/dashboard", { headers });
  if (response.status === 401 && await refreshSession()) {
    response = await fetch("/api/v1/dashboard", {
      headers: {
        ...headers,
        Authorization: `Bearer ${currentAccessToken()}`,
      },
    });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message ?? `Dashboard request failed (${response.status}).`);
  }
  return body.data;
}

function showAuthenticatedApp() {
  authGate?.classList.add("production-hidden");
  appShell?.classList.remove("production-hidden");
}

function showLogin() {
  dashboardData = null;
  authGate?.classList.remove("production-hidden");
  appShell?.classList.add("production-hidden");
}

function renderLiveDashboard(data) {
  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = String(value);
  };
  setText("#metric-suppliers", data.supplierCount);
  setText("#metric-plots", data.plotCount);
  setText("#metric-reviews", data.openReviewCount);
  setText("#metric-documents", data.documentCount);
  setText("#overview-title", `Organization dashboard`);
  setText("#overview-route", `Live data · ${data.organizationId} · ${new Date(data.generatedAt).toLocaleString()}`);
  const supplierBody = document.querySelector("#suppliers-body");
  if (supplierBody) {
    supplierBody.innerHTML = data.suppliers.length
      ? data.suppliers.map((supplier) => `<tr><td><strong>${escapeHtml(supplier.name)}</strong><small>${escapeHtml(supplier.id)}</small></td><td>${escapeHtml(supplier.region)}</td><td>${supplier.producerCount}</td><td>${supplier.plotCount}</td><td><span class="badge success">Live</span></td><td>${escapeHtml(new Date(supplier.updatedAt).toLocaleString())}</td></tr>`).join("")
      : `<tr><td colspan="6"><div class="live-empty">No supplier data is available for this organization.</div></td></tr>`;
  }
  const lineage = document.querySelector("#lineage");
  if (lineage) {
    lineage.innerHTML = data.plots.length
      ? data.plots.slice(0, 4).map((plot) => `<div class="lineage-node"><small>${escapeHtml(plot.geofenceStatus)}</small><strong>${escapeHtml(plot.farmName)}</strong><em>${escapeHtml(plot.producer)} · ${escapeHtml(plot.areaHa)} ha</em></div>`).join("")
      : `<div class="live-empty">No plot data is available for this organization.</div>`;
  }
  const worklist = document.querySelector("#worklist");
  if (worklist) {
    worklist.innerHTML = data.operations.length
      ? data.operations.slice(0, 6).map((operation) => `<li><span class="task-priority ${operation.status === "failed" ? "high" : "low"}"></span><div><strong>${escapeHtml(operation.kind)}</strong><small>${escapeHtml(operation.status)} · ${escapeHtml(operation.phase ?? "queued")}</small></div></li>`).join("")
      : `<li><div><strong>No operational requests</strong><small>Live workspace is clear.</small></div></li>`;
  }
  const plotsLayout = document.querySelector("#plots-layout");
  if (plotsLayout) {
    plotsLayout.innerHTML = `<article class="panel"><p class="eyebrow">LIVE PLOTS</p><div class="production-table">${data.plots.length ? data.plots.slice(0, 12).map((plot) => `<div class="lineage-node"><small>${escapeHtml(plot.geofenceStatus)}</small><strong>${escapeHtml(plot.farmName)}</strong><em>${escapeHtml(plot.producer)} · ${escapeHtml(plot.areaHa)} ha</em></div>`).join("") : '<div class="live-empty">No plot data is available for this organization.</div>'}</div></article><article class="panel"><p class="eyebrow">DATA CAPABILITY</p><h3>Geofence status</h3><p class="muted">Plot geofence state is read from the backend and is not replaced with a local estimate.</p></article>`;
  }
  const unsupportedViews = ["shipments", "risk", "dds"];
  unsupportedViews.forEach((viewId) => {
    const link = document.querySelector(`[data-view="${viewId}"]`);
    const section = document.querySelector(`#${viewId}`);
    const supported = data.capabilities[viewId === "risk" ? "riskSignals" : viewId === "shipments" ? "shipments" : "dds"];
    link?.classList.toggle("hidden", !supported);
    section?.classList.toggle("hidden", !supported);
  });
}

async function loadProductionDashboard() {
  setAuthMessage("Loading secure workspace…");
  try {
    if (!currentAccessToken()) throw new Error("Sign in required.");
    dashboardData = await dashboardRequest();
    showAuthenticatedApp();
    setAuthMessage("");
    renderLiveDashboard(dashboardData);
  } catch (error) {
    sessionStorage.clear();
    showLogin();
    setAuthMessage(error.message);
  }
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  const payload = {
    email: form.get("email"),
    password: form.get("password"),
    ...(form.get("organizationSlug") ? { organizationSlug: form.get("organizationSlug") } : {}),
  };
  setAuthMessage("Authenticating…");
  try {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "Login failed.");
    saveSession(body.data);
    await loadProductionDashboard();
  } catch (error) {
    sessionStorage.clear();
    setAuthMessage(error.message);
  }
});

function showView(viewId) {
  const selected = views.find((view) => view.id === viewId) ?? views[0];

  views.forEach((view) => view.classList.toggle("active", view === selected));
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.view === selected.id);
  });
  pageTitle.textContent = translate(activeLanguage, selected.dataset.titleKey);
}

function setLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    return;
  }

  activeLanguage = language;
  localStorage.setItem("sctracker.language", language);
  document.documentElement.lang = language;
  applyTranslations(document, language);
  renderDynamicContent();
  showView(location.hash.slice(1) || "overview");

  languageButtons.forEach((button) => {
    const isActive = button.dataset.language === language;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function setLayout(layout) {
  const nextLayout = layout === "classic" ? "classic" : "command";
  document.documentElement.dataset.layout = nextLayout;
  localStorage.setItem("sctracker.layout", nextLayout);
  layoutToggle?.setAttribute("aria-pressed", String(nextLayout === "command"));
  if (layoutLabel) layoutLabel.textContent = nextLayout === "command" ? "COMMAND" : "CLASSIC";
}

function closeAccountMenu() {
  if (!accountDropdown || !accountToggle) return;
  accountDropdown.hidden = true;
  accountToggle.setAttribute("aria-expanded", "false");
}

async function logoutFromBackend() {
  const accessToken = sessionStorage.getItem("accessToken");
  const refreshToken = sessionStorage.getItem("refreshToken");
  let serverLogoutFailed = false;

  if (refreshToken) {
    try {
      const response = await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ refreshToken }),
      });
      serverLogoutFailed = !response.ok && response.status !== 401;
    } catch {
      serverLogoutFailed = true;
    }
  }

  sessionStorage.removeItem("accessToken");
  sessionStorage.removeItem("refreshToken");
  sessionStorage.removeItem("selectedOrganizationId");
  showLogin();
  toast.textContent = serverLogoutFailed
    ? "Lokal abgemeldet; Server war nicht erreichbar"
    : "Sitzung beendet";
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

accountToggle?.addEventListener("click", (event) => {
  event.stopPropagation();
  const isOpen = !accountDropdown.hidden;
  accountDropdown.hidden = isOpen;
  accountToggle.setAttribute("aria-expanded", String(!isOpen));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".account-menu")) closeAccountMenu();
});

document.querySelectorAll("[data-account-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    closeAccountMenu();
    if (button.dataset.accountAction === "profile") {
      profileDialog?.showModal();
      return;
    }
    await logoutFromBackend();
  });
});

document.querySelectorAll("[data-profile-close]").forEach((button) => {
  button.addEventListener("click", () => profileDialog?.close());
});

profileDialog?.addEventListener("click", (event) => {
  if (event.target === profileDialog) profileDialog.close();
});

document.querySelector("#invite-supplier-button")?.addEventListener("click", () => {
  document.querySelector("#invite-supplier-status").textContent = "";
  inviteSupplierDialog?.showModal();
});
document.querySelectorAll("[data-invite-close]").forEach((button) => {
  button.addEventListener("click", () => inviteSupplierDialog?.close());
});
inviteSupplierDialog?.addEventListener("click", (event) => {
  if (event.target === inviteSupplierDialog) inviteSupplierDialog.close();
});
inviteSupplierForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(inviteSupplierForm);
  const status = document.querySelector("#invite-supplier-status");
  const submit = inviteSupplierForm.querySelector('[type="submit"]');
  const payload = {
    legalName: String(form.get("name")).trim(),
    email: String(form.get("email")).trim(),
    ...(selectedOrganizationId() ? { organizationId: selectedOrganizationId() } : {}),
  };
  submit.disabled = true;
  status.textContent = translate(activeLanguage, "supplier.inviteSending");
  try {
    const send = () => fetch("/api/v1/supplier-invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentAccessToken()}` },
      body: JSON.stringify(payload),
    });
    let response = await send();
    if (response.status === 401 && await refreshSession()) response = await send();
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message ?? translate(activeLanguage, "supplier.inviteFailed"));
    inviteSupplierDialog.close();
    inviteSupplierForm.reset();
    toast.textContent = translate(activeLanguage, "supplier.inviteSuccess");
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

layoutToggle?.addEventListener("click", () => {
  setLayout(document.documentElement.dataset.layout === "command" ? "classic" : "command");
});

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const viewId = link.dataset.view;
    history.replaceState(null, "", `#${viewId}`);
    showView(viewId);
  });
});

languageButtons.forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.language));
});

document.querySelectorAll("[data-toast-key]").forEach((button) => {
  button.addEventListener("click", () => {
    toast.textContent = translate(activeLanguage, button.dataset.toastKey);
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
  });
});

if (!balance.balanced) {
  console.warn("Demo shipment mass balance is not balanced", balance);
}

setLayout(localStorage.getItem("sctracker.layout") ?? "command");
setLanguage(activeLanguage);
loadProductionDashboard();
