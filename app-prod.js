import { calculateCompletion } from "./src/domain.mjs?v=1";
import {
  SUPPORTED_LANGUAGES,
  applyTranslations,
  translate,
} from "./src/i18n.mjs?v=1";
import { format } from "./src/i18n-prod.mjs?v=1";
import { initEditionSwitch } from "./src/edition.mjs?v=1";
import {
  buildMapSvg, groupOptions, plotTone, plotsInGroup, plotsForPolygonView,
} from "./src/plot-map.mjs?v=1";

const SHIPMENT_STATUSES = ["planned", "in_transit", "arrived", "cancelled"];
const CORRECTION_SCOPES = ["plot", "group", "all"];
const CORRECTION_GROUP_TYPES = ["supplier", "producer"];
const CORRECTION_CATEGORIES = ["geometry", "area", "geofence", "duplicate", "evidence", "other"];
const CHECK_GLYPH = { ok: "✓", fail: "!", pending: "·" };
const WRITE_ROLES = ["system_admin", "org_admin", "reviewer"];
const ADMIN_ROLES = ["system_admin", "org_admin"];
const STATUS_TONE = {
  planned: "neutral", in_transit: "warning", arrived: "success", cancelled: "danger",
  pending: "neutral", inside: "success", approved: "success", outside: "warning",
  review_required: "warning", rejected: "danger", queued: "neutral", processing: "neutral",
  completed: "success", failed: "danger", not_configured: "warning", initiated: "neutral",
  uploaded: "neutral", open: "warning", resolved: "success",
};
const DETAIL_VIEW = {
  supplier: "suppliers", correction: "plots", shipment: "shipments",
  review: "risk", operation: "dds", document: "dds",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const state = {
  language: initialLanguage(),
  user: null,
  organizationId: null,
  organizations: [],
  organization: null,
  dashboard: null,
  shipments: [],
  plots: [],
  plotsFailed: false,
  corrections: [],
  plotTab: "all",
  selectedPlotIds: new Set(),
  editingShipmentId: null,
  deletingShipmentId: null,
};

class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function initialLanguage() {
  const stored = localStorage.getItem("sctracker.language");
  if (SUPPORTED_LANGUAGES.includes(stored)) return stored;
  const browser = navigator.language.toLowerCase();
  if (browser.startsWith("am")) return "am";
  if (browser.startsWith("en")) return "en";
  return "de";
}

const t = (key, values) => {
  const text = translate(state.language, key);
  return values ? format(text, values) : text;
};
const labelFor = (prefix, value) => {
  const key = `${prefix}.${value}`;
  const text = translate(state.language, key);
  return text === key ? String(value ?? "—") : text;
};
const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(state.language) : "—");
const formatDateTime = (iso) => (iso
  ? new Date(iso).toLocaleString(state.language, { dateStyle: "medium", timeStyle: "short" })
  : "—");
const formatNumber = (value, digits = 3) =>
  Number(value ?? 0).toLocaleString(state.language, { maximumFractionDigits: digits });
const shortId = (id) => String(id ?? "").slice(0, 8);
const statusBadge = (status) =>
  `<span class="badge ${STATUS_TONE[status] ?? "neutral"}">${escapeHtml(labelFor("prod.status", status))}</span>`;
const canWrite = () => WRITE_ROLES.includes(state.user?.role);
const canDelete = () => ADMIN_ROLES.includes(state.user?.role);

/* ---------- session ---------- */

const accessToken = () => sessionStorage.getItem("accessToken");

function saveSession(payload) {
  sessionStorage.setItem("accessToken", payload.accessToken);
  sessionStorage.setItem("refreshToken", payload.refreshToken);
  if (payload.selectedOrganizationId) {
    sessionStorage.setItem("selectedOrganizationId", payload.selectedOrganizationId);
  }
  if (payload.user) sessionStorage.setItem("user", JSON.stringify(payload.user));
}

function storedUser() {
  try {
    return JSON.parse(sessionStorage.getItem("user") ?? "null");
  } catch {
    return null;
  }
}

let refreshing = null;
function refreshSession() {
  refreshing ??= (async () => {
    const refreshToken = sessionStorage.getItem("refreshToken");
    if (!refreshToken) return false;
    try {
      const response = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      saveSession((await response.json()).data);
      return true;
    } catch {
      return false;
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function api(path, { method = "GET", body } = {}) {
  const url = new URL(path, location.origin);
  // System administrators are not bound to one organization and must name it explicitly.
  if (state.organizationId && state.user?.role === "system_admin") {
    url.searchParams.set("organizationId", state.organizationId);
  }
  const send = () => fetch(url.pathname + url.search, {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${accessToken()}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let response = await send();
  if (response.status === 401 && await refreshSession()) response = await send();
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? `Request failed (${response.status}).`,
      response.status, payload?.error?.code, payload?.error?.details,
    );
  }
  return payload?.data;
}

function describeError(error, fallbackKey) {
  const fields = error?.details?.fieldErrors;
  if (fields && Object.keys(fields).length) {
    return Object.entries(fields).map(([field, messages]) => `${field}: ${messages.join(", ")}`).join(" · ");
  }
  return error?.message || t(fallbackKey);
}

/* ---------- elements ---------- */

const authGate = $("#auth-gate");
const appShell = $("#app-shell");
const authStatus = $("#auth-status");
const toast = $("#toast");
const pageTitle = $("#page-title");
const layoutToggle = $("#layout-toggle");
const layoutLabel = $("#layout-label");
const accountToggle = $("#account-toggle");
const accountDropdown = $("#account-dropdown");
const orgName = $("#org-name");
let toastTimer;

function showToast(text, duration = 3200) {
  toast.textContent = text;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), duration);
}

const setAuthMessage = (text = "") => { authStatus.textContent = text; };

function showApp() {
  authGate.classList.add("production-hidden");
  appShell.classList.remove("production-hidden");
}

function showLogin() {
  state.dashboard = null;
  state.organization = null;
  state.shipments = [];
  state.plots = [];
  state.plotsFailed = false;
  state.corrections = [];
  state.plotTab = "all";
  state.selectedPlotIds.clear();
  state.user = null;
  state.organizationId = null;
  $$("dialog[open]").forEach((dialog) => dialog.close());
  orgName.dataset.i18n = "prod.org.loading";
  orgName.textContent = t("prod.org.loading");
  authGate.classList.remove("production-hidden");
  appShell.classList.add("production-hidden");
}

/* ---------- data loading ---------- */

async function resolveOrganization() {
  if (state.user.role !== "system_admin") {
    state.organizationId = state.user.organizationId;
    return;
  }
  state.organizations = await api("/api/v1/admin/organizations");
  const stored = sessionStorage.getItem("selectedOrganizationId");
  const selected = state.organizations.find((item) => item.id === stored) ?? state.organizations[0];
  if (!selected) throw new Error(t("prod.login.noOrganization"));
  state.organizationId = selected.id;
  sessionStorage.setItem("selectedOrganizationId", selected.id);
}

async function reloadData() {
  // Geometries and corrections are optional: the rest of the workspace stays usable if they fail to load.
  const optional = (path) => api(path).catch((error) => {
    if (error.status === 401) throw error;
    return null;
  });
  let plots;
  let corrections;
  [state.dashboard, state.shipments, state.organization, plots, corrections] = await Promise.all([
    api("/api/v1/dashboard"),
    api("/api/v1/shipments"),
    api("/api/v1/organization"),
    optional("/api/v1/plots"),
    optional("/api/v1/plot-corrections"),
  ]);
  state.plotsFailed = plots === null || corrections === null;
  state.plots = plots ?? [];
  state.corrections = corrections ?? [];
}

async function loadWorkspace() {
  setAuthMessage(t("prod.login.loading"));
  try {
    if (!accessToken()) throw new ApiError("", 401);
    state.user = storedUser() ?? await api("/api/v1/auth/me");
    sessionStorage.setItem("user", JSON.stringify(state.user));
    await resolveOrganization();
    await reloadData();
    showApp();
    setAuthMessage("");
    renderAll();
    showView(location.hash.slice(1) || "overview");
  } catch (error) {
    if (error.status === 401) sessionStorage.clear();
    showLogin();
    setAuthMessage(error.status === 401 && !error.message ? "" : describeError(error, "prod.common.loadFailed"));
  }
}

async function refreshWorkspace() {
  await reloadData();
  renderAll();
}

/* ---------- rendering ---------- */

function emptyRow(columns, key) {
  return `<tr><td colspan="${columns}"><div class="live-empty">${escapeHtml(t(key))}</div></td></tr>`;
}

function renderHeader() {
  const name = state.organization?.name ?? "—";
  delete orgName.dataset.i18n;
  orgName.textContent = name;
  const user = state.user;
  $("#account-name").textContent = user?.displayName ?? "—";
  $("#account-role").textContent = labelFor("prod.role", user?.role);
  accountToggle.textContent = (user?.displayName ?? "?").trim().slice(0, 2).toUpperCase();
  $("#new-shipment-button").hidden = !canWrite();
  $("#invite-supplier-button").hidden = !ADMIN_ROLES.includes(user?.role);
}

function renderOverview() {
  const { dashboard, organization, shipments } = state;
  $("#overview-title").textContent = organization?.name ?? "—";
  $("#overview-route").textContent =
    `${organization?.slug ?? ""} · ${t("prod.overview.updated")} ${formatDateTime(dashboard.generatedAt)}`;
  const totalKg = shipments.filter((item) => item.status !== "cancelled")
    .reduce((sum, item) => sum + item.quantityKg, 0);
  $("#hero-meta").innerHTML = [
    t("prod.overview.shipmentCount", { n: dashboard.shipmentCount }),
    `${formatNumber(totalKg, 0)} kg`,
    t("prod.overview.supplierCount", { n: dashboard.supplierCount }),
    t("prod.overview.plotCount", { n: dashboard.plotCount }),
  ].map((text) => `<span>${escapeHtml(text)}</span>`).join("");

  const completion = calculateCompletion({
    supplier: dashboard.supplierCount > 0,
    plots: dashboard.plotCount > 0,
    shipments: dashboard.shipmentCount > 0,
    evidence: dashboard.documentCount > 0,
    reviews: dashboard.openReviewCount === 0,
    dds: dashboard.operations.some((item) => item.kind === "dds" && item.status === "completed"),
  });
  $("#completion-score").textContent = `${completion}%`;
  $(".score-ring").setAttribute("aria-label", `${completion}% ${t("overview.complete")}`);

  $("#metric-suppliers").textContent = formatNumber(dashboard.supplierCount, 0);
  $("#metric-plots").textContent = formatNumber(dashboard.plotCount, 0);
  $("#metric-shipments").textContent = formatNumber(dashboard.shipmentCount, 0);
  $("#metric-reviews").textContent = formatNumber(dashboard.openReviewCount, 0);
  $("#metric-documents").textContent = formatNumber(dashboard.documentCount, 0);

  $("#lineage").innerHTML = shipments.length
    ? shipments.slice(0, 4).map((shipment) => `
        <button type="button" class="lineage-node" data-detail="shipment" data-id="${escapeHtml(shipment.id)}">
          <small>${escapeHtml(labelFor("prod.status", shipment.status))}</small>
          <strong>${escapeHtml(shipment.reference)}</strong>
          <em>${escapeHtml([shipment.product, `${formatNumber(shipment.quantityKg)} kg`].filter(Boolean).join(" · "))}</em>
        </button>`).join("")
    : `<div class="live-empty">${escapeHtml(t("prod.shipment.empty"))}</div>`;

  const tasks = [
    ...dashboard.reviews.filter((review) => review.status === "pending").map((review) => ({
      detail: "review", id: review.id, high: false,
      title: t("prod.task.review"),
      text: `${labelFor("prod.review", review.type)} · ${review.reason}`,
    })),
    ...dashboard.operations.filter((operation) => operation.status === "failed").map((operation) => ({
      detail: "operation", id: operation.id, high: true,
      title: t("prod.task.failedOperation"),
      text: `${labelFor("prod.kind", operation.kind)} · ${shortId(operation.subjectId)}`,
    })),
  ];
  $("#worklist-count").textContent = String(tasks.length);
  $("#worklist").innerHTML = tasks.length
    ? tasks.slice(0, 6).map((task) => `
        <li data-detail="${task.detail}" data-id="${escapeHtml(task.id)}" tabindex="0" role="button">
          <span class="task-priority ${task.high ? "high" : "low"}"></span>
          <div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.text)}</small></div>
        </li>`).join("")
    : `<li><div><strong>${escapeHtml(t("prod.overview.noTasks"))}</strong></div></li>`;
}

function renderSuppliers() {
  const { suppliers } = state.dashboard;
  $("#suppliers-body").innerHTML = suppliers.length
    ? suppliers.map((supplier) => `
        <tr data-detail="supplier" data-id="${escapeHtml(supplier.id)}" tabindex="0">
          <td><strong>${escapeHtml(supplier.name)}</strong><small>${escapeHtml(supplier.registrationNumber || shortId(supplier.id))}</small></td>
          <td>${escapeHtml(supplier.countryCode || supplier.region || "—")}</td>
          <td>${formatNumber(supplier.producerCount, 0)}</td>
          <td>${formatNumber(supplier.plotCount, 0)}</td>
          <td><strong>${escapeHtml(supplier.contactName || "—")}</strong><small>${escapeHtml(supplier.contactEmail ?? "")}</small></td>
          <td>${escapeHtml(formatDateTime(supplier.updatedAt))}</td>
        </tr>`).join("")
    : emptyRow(6, "prod.supplier.empty");
}

const scopeText = (correction) => {
  if (correction.scope === "group") {
    return `${labelFor("prod.corr.group", correction.groupType)}: ${correction.groupLabel}`;
  }
  if (correction.scope === "plot") {
    const plot = state.plots.find((item) => item.id === correction.plots[0]?.plotId);
    return `${t("prod.corr.scope.plot")}${plot ? `: ${plot.farmName}` : ""}`;
  }
  return t("prod.corr.scope.all");
};

function selectPlotTab(tab) {
  state.plotTab = tab;
  renderPlots();
}

function openPlotTab(id) {
  $$("dialog[open]").forEach((dialog) => dialog.close());
  history.replaceState(null, "", "#plots");
  showView("plots");
  selectPlotTab(id);
  window.scrollTo({ top: 0 });
}

function renderPlotTabs() {
  const tab = (id, label, { tone = "", flag = false, hint = "" } = {}) => {
    const active = id === state.plotTab;
    return `<button type="button" role="tab" class="plot-tab${active ? " active" : ""}" data-plot-tab="${escapeHtml(id)}"
        aria-selected="${active}" tabindex="${active ? 0 : -1}" title="${escapeHtml(hint || label)}">
        ${tone ? `<i class="tone-dot ${tone}"></i>` : ""}<span>${escapeHtml(label)}</span>
        ${flag ? `<em class="tab-flag" aria-hidden="true">!</em>` : ""}</button>`;
  };
  $("#plot-tabs").innerHTML = tab("all", t("prod.pv.backToList"))
    + (state.plotTab === "selection" ? tab("selection", t("prod.pv.selectedPolygons")) : "")
    + state.plots.map((plot) => tab(plot.id, plot.farmName, {
      tone: plotTone(plot),
      flag: plot.openCorrectionCount > 0,
      hint: `${plot.farmName} · ${plot.producer} · ${shortId(plot.id)}`,
    })).join("");
}

function renderPlots() {
  if (!state.dashboard) return;
  const plot = state.plots.find((item) => item.id === state.plotTab);
  if (!plot && (state.plotTab !== "selection" || !state.plots.length)) state.plotTab = "all";
  const polygonView = state.plotTab !== "all";
  $("#show-polygons-button").hidden = polygonView;
  $("#show-polygons-button").disabled = !state.plots.length || state.plotsFailed;
  $("#plots-load-status").hidden = !state.plotsFailed;
  $("#plot-tabs").hidden = !polygonView;
  $("#plots-list").hidden = polygonView;
  $("#plots-map-view").hidden = state.plotTab !== "selection";
  $("#plots-all").hidden = Boolean(plot);
  $("#plot-pane").hidden = !plot;
  renderPlotTabs();
  if (plot) renderPlotPane(plot);
  else renderPlotsOverview();
}

function renderPlotsOverview() {
  const { corrections } = state;
  const tableRows = state.plots.length || !state.plotsFailed ? state.plots : state.dashboard.plots;
  const plots = plotsForPolygonView(state.plots, state.selectedPlotIds);
  const message = !plots.length
    ? `<div class="live-empty map-empty">${escapeHtml(t(state.plotsFailed ? "prod.pv.loadFailed" : "prod.plot.empty"))}</div>`
    : "";
  const legend = ["ok", "fail", "pending"].map((tone) =>
    `<span><i class="${tone}"></i>${escapeHtml(t(`prod.pv.legend.${tone}`))}</span>`).join("");
  $("#plots-map").innerHTML = `<span class="terrain terrain-one"></span><span class="terrain terrain-two"></span>
    ${buildMapSvg(plots, { interactive: true, numbers: "index" }, escapeHtml)}${message}
    <div class="map-key"><strong>${escapeHtml(t("prod.pv.count", { n: formatNumber(plots.length, 0) }))}</strong>${legend}</div>`;

  const checkRow = (tone, text) =>
    `<div><span class="check ${tone}">${CHECK_GLYPH[tone]}</span><span>${escapeHtml(text)}</span></div>`;
  const openRequests = corrections.filter((item) => item.status === "open"
    && item.plots.some((entry) => plots.some((plot) => plot.id === entry.plotId))).length;
  $("#plots-summary-title").textContent = t("prod.pv.summaryOpen", { n: formatNumber(openRequests, 0) });
  $("#plots-summary").innerHTML = [
    checkRow("ok", t("prod.pv.summaryClean", { n: plots.filter((item) => plotTone(item) === "ok").length })),
    checkRow("fail", t("prod.pv.summaryIssues", { n: plots.filter((item) => plotTone(item) === "fail").length })),
    checkRow("pending", t("prod.pv.summaryOpenPlots", { n: plots.filter((item) => item.openCorrectionCount > 0).length })),
  ].join("");
  $("#request-all-button").hidden = !canWrite() || !plots.length;
  $("#request-group-button").hidden = !canWrite()
    || !CORRECTION_GROUP_TYPES.some((type) => groupOptions(plots, type).length);
  $("#request-selected-buttons").innerHTML = canWrite() ? plots.map((plot) =>
    `<button class="secondary-button" type="button" data-correction-plot="${escapeHtml(plot.id)}">
      ${escapeHtml(t("plot.requestCorrection"))} · ${escapeHtml(plot.farmName)}</button>`).join("") : "";

  $("#plots-body").innerHTML = tableRows.length
    ? tableRows.map((plot) => `
        <tr>
          <td><input type="checkbox" data-plot-select="${escapeHtml(plot.id)}"
            aria-label="${escapeHtml(t("prod.pv.selectPlot", { name: plot.farmName }))}"
            ${state.selectedPlotIds.has(plot.id) ? "checked" : ""}
            ${state.plotsFailed ? "disabled" : ""}></td>
          <td><strong>${escapeHtml(plot.farmName)}</strong><small>${escapeHtml(shortId(plot.id))}</small></td>
          <td>${escapeHtml(plot.producer)}</td>
          <td>${escapeHtml(plot.supplierName ?? "—")}</td>
          <td>${formatNumber(plot.areaHa, 4)}</td>
          <td>${statusBadge(plot.geofenceStatus)}</td>
          <td>${escapeHtml(formatDate(plot.capturedAt))}</td>
          <td>${plot.openCorrectionCount > 0 ? statusBadge("open") : "—"}</td>
        </tr>`).join("")
    : emptyRow(8, "prod.plot.empty");

  $("#corrections-body").innerHTML = corrections.length
    ? corrections.map((correction) => `
        <tr data-detail="correction" data-id="${escapeHtml(correction.id)}" tabindex="0">
          <td>${statusBadge(correction.status)}</td>
          <td>${escapeHtml(scopeText(correction))}</td>
          <td>${escapeHtml(labelFor("prod.corr.category", correction.category))}</td>
          <td class="cell-message">${escapeHtml(correction.message)}</td>
          <td>${escapeHtml(t("prod.corr.openOf", { n: correction.openPlotCount, m: correction.plotCount }))}</td>
          <td>${escapeHtml(formatDateTime(correction.createdAt))}</td>
        </tr>`).join("")
    : emptyRow(6, "prod.corr.empty");
}

function validationRows(plot) {
  const v = plot.validation;
  const row = (checkState, text) =>
    `<div><span class="check ${checkState}">${CHECK_GLYPH[checkState]}</span><span>${escapeHtml(text)}</span></div>`;
  const eoText = { ok: t("prod.val.eo.ok"), fail: t("prod.val.eo.fail"), pending: t("plot.eoPending") };
  return [
    row(v.geofence.state, labelFor("prod.val.geofence", v.geofence.status)),
    row(v.area.state, v.area.state === "ok"
      ? t("prod.val.area.ok", { ha: formatNumber(v.area.storedHa, 2) })
      : t("prod.val.area.fail", { stored: formatNumber(v.area.storedHa, 2), computed: formatNumber(v.area.computedHa, 2) })),
    row(v.selfIntersection.state, v.selfIntersection.state === "ok"
      ? t("prod.val.self.ok") : t("plot.selfIntersection")),
    row(v.duplicate.state, v.duplicate.state === "ok"
      ? t("plot.noDuplicate") : t("prod.val.dup.fail", { n: v.duplicate.count })),
    row(v.eo.state, eoText[v.eo.state]),
  ].join("");
}

function renderPlotPane(plot) {
  const tone = plotTone(plot);
  const key = plot.centroid ? `${plot.centroid.lat.toFixed(5)}, ${plot.centroid.lng.toFixed(5)}` : plot.farmName;
  const requests = state.corrections.filter((item) => item.plots.some((entry) => entry.plotId === plot.id));
  const actions = (request, entry) => (canWrite() && entry.status === "open"
    ? `<div class="row-actions">
        <button type="button" class="secondary-button" data-correction-close data-request-id="${escapeHtml(request.id)}"
          data-plot-id="${escapeHtml(plot.id)}" data-status="resolved">${escapeHtml(t("prod.corr.resolve"))}</button>
        <button type="button" class="danger-button" data-correction-close data-request-id="${escapeHtml(request.id)}"
          data-plot-id="${escapeHtml(plot.id)}" data-status="cancelled">${escapeHtml(t("prod.corr.cancel"))}</button>
      </div>` : "");
  const requestRows = requests.map((request) => {
    const entry = request.plots.find((item) => item.plotId === plot.id);
    return `
        <tr>
          <td>${statusBadge(entry.status)}</td>
          <td>${escapeHtml(labelFor("prod.corr.category", request.category))}</td>
          <td class="cell-message">${escapeHtml(request.message)}${entry.status === "open" && entry.plotUpdated
            ? `<small class="plot-updated">${escapeHtml(t("prod.corr.plotUpdated"))}</small>` : ""}</td>
          <td><strong>${escapeHtml(scopeText(request))}</strong><small>${escapeHtml(request.requestedBy?.displayName ?? "—")}</small></td>
          <td>${escapeHtml(formatDateTime(request.createdAt))}</td>
          <td>${actions(request, entry)}</td>
        </tr>`;
  }).join("");
  $("#plot-pane").innerHTML = `
    <div class="map-layout">
      <article class="map-card">
        <div class="map-placeholder" role="img" aria-label="${escapeHtml(t("prod.pv.mapOne", { name: plot.farmName }))}">
          <span class="terrain terrain-one"></span><span class="terrain terrain-two"></span>
          ${buildMapSvg([plot], { vertices: true }, escapeHtml)}
          <div class="map-key"><i class="${tone}"></i> ${escapeHtml(key)}</div>
        </div>
      </article>
      <article class="panel">
        <p class="eyebrow">${escapeHtml(t("plot.validationResult"))}</p>
        <h3>${escapeHtml(plot.farmName)}</h3>
        <div class="validation-list">${validationRows(plot)}</div>
        ${canWrite() ? `<button class="secondary-button" type="button" data-correction-plot="${escapeHtml(plot.id)}">
          <span>${escapeHtml(t("plot.requestCorrection"))}</span></button>` : ""}
      </article>
    </div>
    <article class="panel">
      <p class="eyebrow">${escapeHtml(t("prod.pv.facts"))}</p>
      <dl class="detail-list">${detailRows([
        [t("prod.plot.producer"), plot.producer],
        [t("prod.plot.supplier"), plot.supplierName],
        [t("prod.plot.area"), formatNumber(plot.areaHa, 4)],
        [t("prod.plot.geofence"), statusBadge(plot.geofenceStatus), true],
        [t("prod.plot.localResult"), statusBadge(plot.localGeofenceResult), true],
        [t("prod.plot.position"), plot.centroid ? key : ""],
        [t("prod.plot.captured"), formatDateTime(plot.capturedAt)],
        [t("prod.plot.revision"), String(plot.revision)],
        [t("prod.common.updated"), formatDateTime(plot.updatedAt)],
        [t("prod.common.id"), plot.id],
      ])}</dl>
    </article>
    <article class="panel table-panel">
      <div class="panel-header table-heading"><h3>${escapeHtml(t("prod.corr.title"))}</h3></div>
      <table>
        <thead><tr>
          <th>${escapeHtml(t("prod.common.status"))}</th>
          <th>${escapeHtml(t("prod.corr.category"))}</th>
          <th>${escapeHtml(t("prod.corr.message"))}</th>
          <th>${escapeHtml(t("prod.corr.scope"))}</th>
          <th>${escapeHtml(t("prod.common.created"))}</th>
          <th></th>
        </tr></thead>
        <tbody>${requestRows || emptyRow(6, "prod.corr.emptyPlot")}</tbody>
      </table>
    </article>`;
}

function renderShipments() {
  $("#shipments-body").innerHTML = state.shipments.length
    ? state.shipments.map((shipment) => `
        <tr data-detail="shipment" data-id="${escapeHtml(shipment.id)}" tabindex="0">
          <td><strong>${escapeHtml(shipment.reference)}</strong><small>${escapeHtml(formatDate(shipment.expectedArrival))}</small></td>
          <td>${escapeHtml(shipment.product || "—")}</td>
          <td>${formatNumber(shipment.quantityKg)} kg</td>
          <td>${escapeHtml([shipment.originRegion, shipment.originCountry].filter(Boolean).join(", ") || "—")}</td>
          <td>${escapeHtml(shipment.supplierName ?? "—")}</td>
          <td>${statusBadge(shipment.status)}</td>
        </tr>`).join("")
    : emptyRow(6, "prod.shipment.empty");
}

function renderRisk() {
  const { plots, documents, operations, reviews, openReviewCount } = state.dashboard;
  const compliant = plots.filter((plot) => ["inside", "approved"].includes(plot.geofenceStatus)).length;
  const completedDocuments = documents.filter((item) => item.status === "completed").length;
  const failedOperations = operations.filter((item) => item.status === "failed").length;
  const percent = (part, total) => (total ? `${Math.round((part / total) * 100)}%` : "—");
  const cards = [
    {
      label: t("prod.risk.geofence"), value: percent(compliant, plots.length),
      detail: t("prod.risk.geofenceDetail", { n: compliant, m: plots.length }),
      warning: plots.length > 0 && compliant < plots.length, goto: "plots",
    },
    {
      label: t("prod.risk.reviews"), value: formatNumber(openReviewCount, 0),
      detail: t("prod.risk.reviewsDetail", { n: openReviewCount }),
      warning: openReviewCount > 0, goto: "risk", scroll: "#reviews-panel",
    },
    {
      label: t("prod.risk.documents"), value: percent(completedDocuments, documents.length),
      detail: t("prod.risk.documentsDetail", { n: completedDocuments, m: documents.length }),
      warning: documents.length > 0 && completedDocuments < documents.length, goto: "dds",
    },
    {
      label: t("prod.risk.operations"), value: formatNumber(failedOperations, 0),
      detail: t("prod.risk.operationsDetail", { n: failedOperations, m: operations.length }),
      warning: failedOperations > 0, goto: "dds",
    },
  ];
  $("#risk-grid").innerHTML = cards.map((card) => `
    <button type="button" class="risk-card ${card.warning ? "warning" : ""}" data-goto="${card.goto}"${card.scroll ? ` data-scroll="${card.scroll}"` : ""}>
      <small>${escapeHtml(card.label)}</small>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </button>`).join("");
  $("#reviews-body").innerHTML = reviews.length
    ? reviews.map((review) => `
        <tr data-detail="review" data-id="${escapeHtml(review.id)}" tabindex="0">
          <td>${escapeHtml(labelFor("prod.review", review.type))}</td>
          <td><small>${escapeHtml(shortId(review.subjectId))}</small></td>
          <td>${escapeHtml(review.reason)}</td>
          <td>${statusBadge(review.status)}</td>
          <td>${escapeHtml(formatDateTime(review.createdAt))}</td>
        </tr>`).join("")
    : emptyRow(5, "prod.review.empty");
}

function renderDds() {
  const { operations, documents } = state.dashboard;
  $("#operations-body").innerHTML = operations.length
    ? operations.map((operation) => `
        <tr data-detail="operation" data-id="${escapeHtml(operation.id)}" tabindex="0">
          <td>${escapeHtml(labelFor("prod.kind", operation.kind))}</td>
          <td><small>${escapeHtml(shortId(operation.subjectId))}</small></td>
          <td>${statusBadge(operation.status)}</td>
          <td>${escapeHtml(operation.phase ?? "—")}</td>
          <td>${escapeHtml(formatDateTime(operation.updatedAt))}</td>
        </tr>`).join("")
    : emptyRow(5, "prod.op.empty");
  $("#documents-body").innerHTML = documents.length
    ? documents.map((file) => `
        <tr data-detail="document" data-id="${escapeHtml(file.id)}" tabindex="0">
          <td><strong>${escapeHtml(file.fileName)}</strong></td>
          <td>${escapeHtml(file.mimeType)}</td>
          <td>${formatNumber(file.byteSize / 1024, 1)} KB</td>
          <td>${statusBadge(file.status)}</td>
          <td>${escapeHtml(formatDateTime(file.createdAt))}</td>
        </tr>`).join("")
    : emptyRow(5, "prod.doc.empty");
}

function renderAll() {
  if (!state.dashboard) return;
  renderHeader();
  renderOverview();
  renderSuppliers();
  renderPlots();
  renderShipments();
  renderRisk();
  renderDds();
}

/* ---------- details ---------- */

function detailRows(rows) {
  return rows.filter(Boolean).map(([label, value, isHtml]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${isHtml ? value : escapeHtml(value || "—")}</dd></div>`).join("");
}

function buildDetail(kind, id) {
  const { dashboard } = state;
  if (kind === "supplier") {
    const s = dashboard.suppliers.find((item) => item.id === id);
    if (!s) return null;
    const address = [s.streetAddress, [s.postalCode, s.city].filter(Boolean).join(" "), s.countryCode]
      .filter(Boolean).join(", ");
    return {
      eyebrow: t("prod.detail.supplier"), title: s.name,
      rows: [
        [t("prod.f.tradingName"), s.tradingName],
        [t("prod.f.registrationNumber"), s.registrationNumber],
        [t("prod.f.taxId"), s.taxId],
        [t("prod.f.region"), s.region],
        [t("prod.f.address"), address],
        [t("prod.f.contactName"), s.contactName],
        [t("prod.f.email"), s.contactEmail],
        [t("prod.f.phone"), s.contactPhone],
        [t("prod.f.website"), s.website],
        [t("supplier.producers"), formatNumber(s.producerCount, 0)],
        [t("supplier.plots"), formatNumber(s.plotCount, 0)],
        [t("prod.plot.revision"), String(s.revision)],
        [t("prod.common.created"), formatDateTime(s.createdAt)],
        [t("prod.common.updated"), formatDateTime(s.updatedAt)],
        [t("prod.common.id"), s.id],
      ],
    };
  }
  if (kind === "correction") {
    const c = state.corrections.find((item) => item.id === id);
    if (!c) return null;
    const plotList = `<ul class="plain-list">${c.plots.map((entry) => {
      const plot = state.plots.find((item) => item.id === entry.plotId);
      return `<li><button type="button" class="link-button" data-plot-tab="${escapeHtml(entry.plotId)}">${escapeHtml(plot?.farmName ?? shortId(entry.plotId))}</button>
        ${statusBadge(entry.status)}</li>`;
    }).join("")}</ul>`;
    const open = canWrite() && c.status === "open";
    return {
      eyebrow: t("prod.detail.correction"), title: scopeText(c),
      rows: [
        [t("prod.common.status"), statusBadge(c.status), true],
        [t("prod.corr.category"), labelFor("prod.corr.category", c.category)],
        [t("prod.corr.message"), c.message],
        [t("prod.corr.plots"), plotList, true],
        [t("prod.corr.requestedBy"), c.requestedBy?.displayName],
        [t("prod.common.created"), formatDateTime(c.createdAt)],
        c.resolvedAt && [t("prod.corr.resolvedBy"), c.resolvedBy],
        c.resolvedAt && [t("prod.corr.resolvedAt"), formatDateTime(c.resolvedAt)],
        c.resolutionNote && [t("prod.review.note"), c.resolutionNote],
        [t("prod.common.id"), c.id],
      ],
      actions: [
        open && { action: "resolve-correction", label: t("prod.corr.resolve"), className: "secondary-button" },
        open && { action: "cancel-correction", label: t("prod.corr.cancel"), className: "danger-button" },
      ],
    };
  }
  if (kind === "shipment") {
    const s = state.shipments.find((item) => item.id === id);
    if (!s) return null;
    return {
      eyebrow: t("prod.detail.shipment"), title: s.reference,
      rows: [
        [t("prod.common.status"), statusBadge(s.status), true],
        [t("prod.shipment.product"), s.product],
        [t("prod.shipment.hsCode"), s.hsCode],
        [t("shipment.quantity"), `${formatNumber(s.quantityKg)} kg`],
        [t("shipment.origin"), [s.originRegion, s.originCountry].filter(Boolean).join(", ")],
        [t("prod.shipment.supplier"), s.supplierName],
        [t("prod.shipment.destination"), s.destination],
        [t("prod.shipment.expectedArrival"), formatDate(s.expectedArrival)],
        [t("prod.shipment.notes"), s.notes],
        [t("prod.common.created"), formatDateTime(s.createdAt)],
        [t("prod.common.updated"), formatDateTime(s.updatedAt)],
        [t("prod.common.id"), s.id],
      ],
      actions: [
        canWrite() && { action: "edit-shipment", label: t("prod.common.edit"), className: "secondary-button" },
        canDelete() && { action: "delete-shipment", label: t("prod.common.delete"), className: "danger-button" },
      ],
    };
  }
  if (kind === "review") {
    const r = dashboard.reviews.find((item) => item.id === id);
    if (!r) return null;
    return {
      eyebrow: t("prod.detail.review"), title: `${labelFor("prod.review", r.type)} · ${shortId(r.subjectId)}`,
      rows: [
        [t("prod.common.status"), statusBadge(r.status), true],
        [t("prod.review.reason"), r.reason],
        [t("prod.review.note"), r.reviewNote],
        [t("prod.common.created"), formatDateTime(r.createdAt)],
        [t("prod.review.reviewedAt"), formatDateTime(r.reviewedAt)],
        [t("prod.review.subject"), r.subjectId],
        [t("prod.common.id"), r.id],
      ],
    };
  }
  if (kind === "operation") {
    const o = dashboard.operations.find((item) => item.id === id);
    if (!o) return null;
    return {
      eyebrow: t("prod.detail.operation"), title: labelFor("prod.kind", o.kind),
      rows: [
        [t("prod.common.status"), statusBadge(o.status), true],
        [t("prod.op.phase"), o.phase],
        [t("prod.op.message"), o.message],
        [t("prod.op.externalReference"), o.externalReference],
        [t("prod.op.subject"), o.subjectId],
        [t("prod.common.created"), formatDateTime(o.createdAt)],
        [t("prod.common.updated"), formatDateTime(o.updatedAt)],
        [t("prod.common.id"), o.id],
      ],
    };
  }
  if (kind === "document") {
    const d = dashboard.documents.find((item) => item.id === id);
    if (!d) return null;
    return {
      eyebrow: t("prod.detail.document"), title: d.fileName,
      rows: [
        [t("prod.common.status"), statusBadge(d.status), true],
        [t("prod.common.type"), d.mimeType],
        [t("prod.doc.size"), `${formatNumber(d.byteSize / 1024, 1)} KB`],
        [t("prod.doc.sha256"), d.sha256],
        [t("prod.common.created"), formatDateTime(d.createdAt)],
        [t("prod.common.updated"), formatDateTime(d.updatedAt)],
        [t("prod.common.id"), d.id],
      ],
    };
  }
  return null;
}

let openDetailRef = null;
function openDetail(kind, id) {
  const detail = buildDetail(kind, id);
  if (!detail) return;
  openDetailRef = { kind, id };
  showView(DETAIL_VIEW[kind]);
  $("#detail-eyebrow").textContent = detail.eyebrow;
  $("#detail-title").textContent = detail.title;
  $("#detail-body").innerHTML = detailRows(detail.rows);
  const actions = (detail.actions ?? []).filter(Boolean).map((item) =>
    `<button type="button" class="${item.className}" data-action="${item.action}">${escapeHtml(item.label)}</button>`);
  actions.push(`<button type="button" class="primary-button" data-dialog-close>${escapeHtml(t("prod.common.close"))}</button>`);
  $("#detail-actions").innerHTML = actions.join("");
  const dialog = $("#detail-dialog");
  if (!dialog.open) dialog.showModal();
}

function openOrganization() {
  const org = state.organization;
  if (!org) return;
  $("#org-title").textContent = org.name;
  const tile = (labelKey, value, goto) => `
    <${goto ? `a href="#${goto}" data-goto="${goto}"` : "div"} class="metric-card">
      <span class="metric-label">${escapeHtml(t(labelKey))}</span>
      <strong>${formatNumber(value, 0)}</strong>
    </${goto ? "a" : "div"}>`;
  const enabled = (flag) => escapeHtml(t(flag ? "prod.orgDetail.enabled" : "prod.orgDetail.disabled"));
  const switcher = state.user.role === "system_admin" && state.organizations.length > 1
    ? `<label class="org-switch"><span>${escapeHtml(t("prod.orgDetail.switch"))}</span>
        <select id="org-switch">${state.organizations.map((item) =>
          `<option value="${escapeHtml(item.id)}"${item.id === org.id ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>`
    : "";
  $("#org-body").innerHTML = `
    <dl class="detail-list">${detailRows([
      [t("prod.orgDetail.slug"), org.slug],
      [t("prod.common.status"), `<span class="badge ${org.active ? "success" : "danger"}">${escapeHtml(t(org.active ? "prod.orgDetail.active" : "prod.orgDetail.inactive"))}</span>`, true],
      [t("prod.common.created"), formatDateTime(org.createdAt)],
      [t("prod.common.updated"), formatDateTime(org.updatedAt)],
      [t("prod.common.id"), org.id],
    ])}</dl>
    <div class="org-tiles">
      ${tile("prod.orgDetail.users", org.counts.users)}
      ${tile("prod.metric.suppliers", org.counts.suppliers, "suppliers")}
      ${tile("prod.metric.plots", org.counts.plots, "plots")}
      ${tile("prod.metric.shipments", org.counts.shipments, "shipments")}
      ${tile("prod.metric.documents", org.counts.documents, "dds")}
      ${tile("prod.op.title", org.counts.operations, "dds")}
    </div>
    ${org.config ? `<h3 class="dialog-subtitle">${escapeHtml(t("prod.orgDetail.config"))}</h3>
      <dl class="detail-list">${detailRows([
        [t("prod.orgDetail.satellite"), enabled(org.config.satelliteEnabled), true],
        [t("prod.orgDetail.evidencePack"), enabled(org.config.evidencePackEnabled), true],
        [t("prod.orgDetail.euMode"), org.config.euMode],
      ])}</dl>` : ""}
    ${org.members.length ? `<h3 class="dialog-subtitle">${escapeHtml(t("prod.orgDetail.members"))}</h3>
      <ul class="member-list">${org.members.map((member) => `
        <li><div><strong>${escapeHtml(member.displayName)}</strong><small>${escapeHtml(member.email)}</small></div>
        <span class="badge ${member.active ? "neutral" : "danger"}">${escapeHtml(labelFor("prod.role", member.role))}</span></li>`).join("")}</ul>` : ""}
    ${switcher}`;
  $("#org-switch")?.addEventListener("change", async (event) => {
    state.organizationId = event.target.value;
    sessionStorage.setItem("selectedOrganizationId", state.organizationId);
    try {
      await reloadData();
      renderAll();
      $("#org-dialog").close();
    } catch (error) {
      showToast(describeError(error, "prod.common.loadFailed"));
    }
  });
  const dialog = $("#org-dialog");
  if (!dialog.open) dialog.showModal();
}

/* ---------- shipments ---------- */

function openShipmentForm(shipment = null) {
  state.editingShipmentId = shipment?.id ?? null;
  const form = $("#shipment-form");
  form.reset();
  $("#shipment-dialog-title").textContent = t(shipment ? "prod.shipment.editTitle" : "prod.shipment.createTitle");
  $("#shipment-supplier").innerHTML =
    `<option value="">${escapeHtml(t("prod.shipment.noSupplier"))}</option>` +
    state.dashboard.suppliers.map((supplier) =>
      `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`).join("");
  $("#shipment-status").innerHTML = SHIPMENT_STATUSES.map((status) =>
    `<option value="${status}">${escapeHtml(labelFor("prod.status", status))}</option>`).join("");
  if (shipment) {
    const values = {
      reference: shipment.reference, product: shipment.product, hsCode: shipment.hsCode,
      quantityKg: shipment.quantityKg, originCountry: shipment.originCountry,
      originRegion: shipment.originRegion, supplierId: shipment.supplierId ?? "",
      destination: shipment.destination, status: shipment.status,
      expectedArrival: shipment.expectedArrival ?? "", notes: shipment.notes,
    };
    for (const [name, value] of Object.entries(values)) form.elements[name].value = value;
  }
  $("#shipment-form-status").textContent = "";
  $$("dialog[open]").forEach((dialog) => dialog.close());
  $("#shipment-dialog").showModal();
}

$("#shipment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const payload = {
    reference: String(data.get("reference")).trim(),
    product: String(data.get("product")).trim(),
    hsCode: String(data.get("hsCode")).trim(),
    quantityKg: Number(data.get("quantityKg")),
    originCountry: String(data.get("originCountry")).trim(),
    originRegion: String(data.get("originRegion")).trim(),
    supplierId: data.get("supplierId") || null,
    destination: String(data.get("destination")).trim(),
    status: data.get("status"),
    expectedArrival: data.get("expectedArrival") || null,
    notes: String(data.get("notes")).trim(),
  };
  const status = $("#shipment-form-status");
  const submit = form.querySelector('[type="submit"]');
  const editing = state.editingShipmentId;
  submit.disabled = true;
  status.textContent = t("prod.shipment.saving");
  try {
    await api(editing ? `/api/v1/shipments/${editing}` : "/api/v1/shipments", {
      method: editing ? "PATCH" : "POST", body: payload,
    });
    $("#shipment-dialog").close();
    await refreshWorkspace();
    showToast(t(editing ? "prod.shipment.saved" : "prod.shipment.created"));
  } catch (error) {
    if (error.status === 401) return showLogin();
    status.textContent = describeError(error, "prod.shipment.saveFailed");
  } finally {
    submit.disabled = false;
  }
});

$("#confirm-delete").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const status = $("#confirm-status");
  button.disabled = true;
  status.textContent = "";
  try {
    await api(`/api/v1/shipments/${state.deletingShipmentId}`, { method: "DELETE" });
    $("#confirm-dialog").close();
    await refreshWorkspace();
    showToast(t("prod.shipment.deleted"));
  } catch (error) {
    if (error.status === 401) return showLogin();
    status.textContent = describeError(error, "prod.shipment.deleteFailed");
  } finally {
    button.disabled = false;
  }
});

function confirmShipmentDelete(shipment) {
  state.deletingShipmentId = shipment.id;
  $("#confirm-text").textContent = t("prod.shipment.deleteText", { ref: shipment.reference });
  $("#confirm-status").textContent = "";
  $$("dialog[open]").forEach((dialog) => dialog.close());
  $("#confirm-dialog").showModal();
}

$("#new-shipment-button").addEventListener("click", () => openShipmentForm());

$("#detail-actions").addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action || !openDetailRef) return;
  if (openDetailRef.kind === "correction") {
    if (action === "resolve-correction") closeCorrection(openDetailRef.id, "resolved");
    if (action === "cancel-correction") closeCorrection(openDetailRef.id, "cancelled");
    return;
  }
  const shipment = openDetailRef.kind === "shipment"
    ? state.shipments.find((item) => item.id === openDetailRef.id)
    : null;
  if (!shipment) return;
  if (action === "edit-shipment") openShipmentForm(shipment);
  if (action === "delete-shipment") confirmShipmentDelete(shipment);
});

/* ---------- plot corrections ---------- */

async function closeCorrection(requestId, status, plotId = null) {
  const path = `/api/v1/plot-corrections/${requestId}${plotId ? `/plots/${plotId}` : ""}`;
  try {
    await api(path, { method: "PATCH", body: { status } });
    $$("dialog[open]").forEach((dialog) => dialog.close());
    await refreshWorkspace();
    showToast(status === "resolved" ? t("prod.corr.resolved") : t("prod.corr.cancelled"));
  } catch (error) {
    if (error.status === 401) return showLogin();
    showToast(describeError(error, "prod.corr.closeFailed"));
  }
}

const correctionForm = $("#correction-form");

function correctionAffectedCount() {
  const scope = $("#correction-scope").value;
  if (scope === "all") return state.plots.length;
  if (scope === "plot") return $("#correction-plot").value ? 1 : 0;
  return plotsInGroup(state.plots, $("#correction-grouptype").value, $("#correction-group").value).length;
}

function updateCorrectionForm({ refillGroups = false } = {}) {
  const scope = $("#correction-scope").value;
  if (refillGroups) {
    const groups = groupOptions(state.plots, $("#correction-grouptype").value);
    $("#correction-group").innerHTML = groups.length
      ? groups.map((group) =>
        `<option value="${escapeHtml(group.key)}">${escapeHtml(`${group.label} (${group.count})`)}</option>`).join("")
      : `<option value="">${escapeHtml(t("prod.corr.noGroups"))}</option>`;
  }
  $("#correction-plot-field").hidden = scope !== "plot";
  $("#correction-grouptype-field").hidden = scope !== "group";
  $("#correction-group-field").hidden = scope !== "group";
  $("#correction-affects").textContent = t("prod.corr.affects", { n: formatNumber(correctionAffectedCount(), 0) });
}

function openCorrectionForm(scope = "all", plotId = null) {
  if (!canWrite() || !state.plots.length) return;
  correctionForm.reset();
  const options = (values, labelOf) =>
    values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labelOf(value))}</option>`).join("");
  $("#correction-scope").innerHTML = options(CORRECTION_SCOPES, (value) => labelFor("prod.corr.scope", value));
  $("#correction-grouptype").innerHTML = options(CORRECTION_GROUP_TYPES, (value) => labelFor("prod.corr.group", value));
  $("#correction-category").innerHTML = options(CORRECTION_CATEGORIES, (value) => labelFor("prod.corr.category", value));
  $("#correction-plot").innerHTML = state.plots.map((plot) =>
    `<option value="${escapeHtml(plot.id)}">${escapeHtml(`${plot.farmName} · ${plot.producer}`)}</option>`).join("");
  $("#correction-scope").value = scope;
  if (plotId) $("#correction-plot").value = plotId;
  if (scope === "group") {
    const supplierGroups = groupOptions(state.plots, "supplier").length;
    $("#correction-grouptype").value = supplierGroups ? "supplier" : "producer";
  }
  $("#correction-form-status").textContent = "";
  updateCorrectionForm({ refillGroups: true });
  $$("dialog[open]").forEach((dialog) => dialog.close());
  $("#correction-dialog").showModal();
}

$("#correction-scope").addEventListener("change", () => updateCorrectionForm());
$("#correction-plot").addEventListener("change", () => updateCorrectionForm());
$("#correction-group").addEventListener("change", () => updateCorrectionForm());
$("#correction-grouptype").addEventListener("change", () => updateCorrectionForm({ refillGroups: true }));
$("#request-all-button").addEventListener("click", () => openCorrectionForm("all"));
$("#request-group-button").addEventListener("click", () => openCorrectionForm("group"));
$("#show-polygons-button").addEventListener("click", () => {
  const plots = plotsForPolygonView(state.plots, state.selectedPlotIds);
  if (plots.length) selectPlotTab(plots.length === 1 ? plots[0].id : "selection");
});
$("#plots-body").addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-plot-select]");
  if (!checkbox) return;
  if (checkbox.checked) state.selectedPlotIds.add(checkbox.dataset.plotSelect);
  else state.selectedPlotIds.delete(checkbox.dataset.plotSelect);
});

correctionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(correctionForm);
  const scope = String(data.get("scope"));
  const body = { scope, category: data.get("category"), message: String(data.get("message")).trim() };
  if (scope === "plot") body.plotId = data.get("plotId");
  if (scope === "group") {
    body.groupType = data.get("groupType");
    body.groupKey = data.get("groupKey");
  }
  const status = $("#correction-form-status");
  const submit = correctionForm.querySelector('[type="submit"]');
  submit.disabled = true;
  status.textContent = t("prod.corr.sending");
  try {
    const created = await api("/api/v1/plot-corrections", { method: "POST", body });
    $("#correction-dialog").close();
    await refreshWorkspace();
    showToast(t("prod.corr.created", { n: created.plotCount }));
  } catch (error) {
    if (error.status === 401) return showLogin();
    status.textContent = describeError(error, "prod.corr.createFailed");
  } finally {
    submit.disabled = false;
  }
});

/* ---------- supplier invitation ---------- */

$("#invite-supplier-button").addEventListener("click", () => {
  $("#invite-supplier-status").textContent = "";
  $("#invite-supplier-dialog").showModal();
});

$("#invite-supplier-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const status = $("#invite-supplier-status");
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  status.textContent = t("supplier.inviteSending");
  try {
    await api("/api/v1/supplier-invitations", {
      method: "POST",
      body: {
        legalName: String(data.get("name")).trim(),
        email: String(data.get("email")).trim(),
        ...(state.organizationId ? { organizationId: state.organizationId } : {}),
      },
    });
    $("#invite-supplier-dialog").close();
    form.reset();
    showToast(t("supplier.inviteSuccess"));
  } catch (error) {
    status.textContent = describeError(error, "supplier.inviteFailed");
  } finally {
    submit.disabled = false;
  }
});

/* ---------- navigation and chrome ---------- */

function showView(viewId) {
  const views = $$(".view");
  const selected = views.find((view) => view.id === viewId) ?? views[0];
  views.forEach((view) => view.classList.toggle("active", view === selected));
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === selected.id));
  pageTitle.textContent = translate(state.language, selected.dataset.titleKey);
}

function goTo(viewId, scrollSelector) {
  $$("dialog[open]").forEach((dialog) => dialog.close());
  history.replaceState(null, "", `#${viewId}`);
  showView(viewId);
  if (scrollSelector) $(scrollSelector)?.scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: 0 });
}

function setLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) return;
  state.language = language;
  localStorage.setItem("sctracker.language", language);
  document.documentElement.lang = language;
  applyTranslations(document, language);
  renderAll();
  showView(location.hash.slice(1) || "overview");
  $$("[data-language]").forEach((button) => {
    const active = button.dataset.language === language;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (openDetailRef && $("#detail-dialog").open) openDetail(openDetailRef.kind, openDetailRef.id);
}

function setLayout(layout) {
  const next = layout === "classic" ? "classic" : "command";
  document.documentElement.dataset.layout = next;
  localStorage.setItem("sctracker.layout", next);
  layoutToggle.setAttribute("aria-pressed", String(next === "command"));
  layoutLabel.textContent = next === "command" ? "COMMAND" : "CLASSIC";
}

function closeAccountMenu() {
  accountDropdown.hidden = true;
  accountToggle.setAttribute("aria-expanded", "false");
}

async function logout() {
  const refreshToken = sessionStorage.getItem("refreshToken");
  let serverLogoutFailed = false;
  if (refreshToken) {
    try {
      const response = await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken()}`,
        },
        body: JSON.stringify({ refreshToken }),
      });
      serverLogoutFailed = !response.ok && response.status !== 401;
    } catch {
      serverLogoutFailed = true;
    }
  }
  sessionStorage.clear();
  showLogin();
  showToast(t(serverLogoutFailed ? "prod.account.signedOutLocal" : "prod.account.signedOut"));
}

function openProfile() {
  const user = state.user;
  $("#profile-name").textContent = user?.displayName ?? "—";
  $("#profile-role").textContent = labelFor("prod.role", user?.role);
  $("#profile-email").textContent = user?.email ?? "—";
  $("#profile-organization").textContent = state.organization?.name ?? "—";
  $("#profile-dialog").showModal();
}

accountToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = !accountDropdown.hidden;
  accountDropdown.hidden = open;
  accountToggle.setAttribute("aria-expanded", String(!open));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".account-menu")) closeAccountMenu();

  const dialogClose = event.target.closest("[data-dialog-close]");
  if (dialogClose) {
    dialogClose.closest("dialog")?.close();
    return;
  }
  const accountAction = event.target.closest("[data-account-action]")?.dataset.accountAction;
  if (accountAction) {
    closeAccountMenu();
    if (accountAction === "profile") openProfile();
    else logout();
    return;
  }
  const correctionClose = event.target.closest("[data-correction-close]");
  if (correctionClose) {
    const { requestId, plotId, status } = correctionClose.dataset;
    closeCorrection(requestId, status, plotId);
    return;
  }
  const correctionPlot = event.target.closest("[data-correction-plot]");
  if (correctionPlot) {
    openCorrectionForm("plot", correctionPlot.dataset.correctionPlot);
    return;
  }
  const plotTab = event.target.closest("[data-plot-tab]");
  if (plotTab) {
    if (plotTab.closest("#plot-tabs")) selectPlotTab(plotTab.dataset.plotTab);
    else openPlotTab(plotTab.dataset.plotTab);
    return;
  }
  const row = event.target.closest("[data-detail]");
  if (row) {
    openDetail(row.dataset.detail, row.dataset.id);
    return;
  }
  const target = event.target.closest("[data-goto]");
  if (target) {
    event.preventDefault();
    goTo(target.dataset.goto, target.dataset.scroll);
    return;
  }
  // Closing on the backdrop only: clicks on the dialog padding stay inside the dialog.
  if (event.target instanceof HTMLDialogElement) {
    const box = event.target.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right
      || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) event.target.close();
  }
});

document.addEventListener("keydown", (event) => {
  const tabs = event.target.closest?.("#plot-tabs");
  if (tabs && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const ids = $$("[data-plot-tab]", tabs).map((tab) => tab.dataset.plotTab);
    const current = Math.max(0, ids.indexOf(state.plotTab));
    const next = event.key === "Home" ? 0
      : event.key === "End" ? ids.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
    selectPlotTab(ids[next]);
    $("#plot-tabs .plot-tab.active")?.focus();
    return;
  }
  if (event.key !== "Enter" && event.key !== " ") return;
  const plotRow = event.target.closest?.("tr[data-plot-tab], g[data-plot-tab]");
  if (plotRow) {
    event.preventDefault();
    openPlotTab(plotRow.dataset.plotTab);
    return;
  }
  const row = event.target.closest?.("tr[data-detail], li[data-detail]");
  if (!row) return;
  event.preventDefault();
  openDetail(row.dataset.detail, row.dataset.id);
});

$("#org-label").addEventListener("click", openOrganization);

layoutToggle.addEventListener("click", () =>
  setLayout(document.documentElement.dataset.layout === "command" ? "classic" : "command"));

$$(".nav-link, .brand").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    goTo(link.dataset.view ?? "overview");
  });
});

$$("[data-language]").forEach((button) =>
  button.addEventListener("click", () => setLanguage(button.dataset.language)));

window.addEventListener("hashchange", () => showView(location.hash.slice(1) || "overview"));

$("#tracehub-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const loginForm = event.currentTarget;
  const form = new FormData(loginForm);
  const slug = String(form.get("organizationSlug") ?? "").trim();
  setAuthMessage(t("prod.login.authenticating"));
  try {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        ...(slug ? { organizationSlug: slug } : {}),
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? t("prod.login.failed"));
    sessionStorage.clear();
    saveSession(body.data);
    loginForm.reset();
    await loadWorkspace();
  } catch (error) {
    sessionStorage.clear();
    setAuthMessage(error.message);
  }
});

setLayout(localStorage.getItem("sctracker.layout") ?? "command");
setLanguage(state.language);
initEditionSwitch("prod");
loadWorkspace();
