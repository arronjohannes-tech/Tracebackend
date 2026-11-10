const managedRoles = ["org_admin", "reviewer", "field_agent", "auditor"];
const pageSize = 25;

export function registrationListUrl({ status = "", search = "", page = 1 } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  return `/api/v1/admin/registrations?${params}`;
}

export function registrationActions(registration) {
  if (registration.status === "pending") return ["approve", "deactivate"];
  if (registration.status === "approved") return ["resend", "deactivate"];
  if (registration.status === "active") return ["deactivate"];
  if (registration.status === "disabled") return ["approve"];
  return [];
}

export function canManageRegistrations(user) {
  return user?.role === "system_admin";
}

export function isExistingAccountReactivation(registration) {
  return registration.status === "disabled" && Boolean(registration.userId);
}

export function registrationApprovalPayload(registration, { organizationId, roles } = {}) {
  if (isExistingAccountReactivation(registration)) {
    return { organizationId: registration.organizationId, roles: registration.roles ?? [] };
  }
  return { organizationId, roles };
}

export function initRegistrationManagement({
  api, t, labelFor, escapeHtml: esc, formatDateTime, currentUser, refresh,
}) {
  const usersSection = document.querySelector("#users");
  usersSection.insertAdjacentHTML("beforeend", `
    <section class="registration-management" id="registration-management" aria-labelledby="registration-title" hidden>
      <div class="panel">
        <div class="panel-heading">
          <div><p class="eyebrow" data-i18n="prod.registration.eyebrow"></p>
            <h2 id="registration-title" data-i18n="prod.registration.title"></h2></div>
          <button type="button" class="secondary-button" id="registration-reload" data-i18n="prod.registration.reload"></button>
        </div>
        <div class="access-filters">
          <label><span data-i18n="prod.registration.search"></span>
            <input id="registration-search" type="search" autocomplete="off"></label>
          <label><span data-i18n="prod.common.status"></span>
            <select id="registration-filter">
              <option value="" data-i18n="prod.registration.all"></option>
              <option value="pending" data-i18n="prod.registration.pending"></option>
              <option value="approved" data-i18n="prod.registration.approved"></option>
              <option value="active" data-i18n="prod.registration.active"></option>
              <option value="disabled" data-i18n="prod.registration.disabled"></option>
            </select></label>
        </div>
        <p id="registration-status" role="status" aria-live="polite"></p>
        <div class="table-wrap">
          <table class="registration-table">
            <thead><tr>
              <th data-i18n="prod.profile.name"></th><th data-i18n="prod.profile.email"></th>
              <th data-i18n="prod.registration.phone"></th><th data-i18n="prod.registration.organization"></th>
              <th data-i18n="prod.common.status"></th><th data-i18n="prod.registration.delivery"></th>
              <th data-i18n="prod.registration.created"></th><th data-i18n="prod.access.actions"></th>
            </tr></thead>
            <tbody id="registrations-body"></tbody>
          </table>
        </div>
        <div class="registration-pagination">
          <button type="button" class="secondary-button" id="registration-previous"
            data-i18n="prod.registration.previous"></button>
          <span id="registration-page" aria-live="polite"></span>
          <button type="button" class="secondary-button" id="registration-next"
            data-i18n="prod.registration.next"></button>
        </div>
      </div>
    </section>
    <dialog id="registration-dialog" class="profile-dialog wide" aria-labelledby="registration-dialog-title">
      <div class="registration-dialog-content">
        <div class="panel-heading"><h2 id="registration-dialog-title"></h2>
          <button type="button" class="dialog-close" data-registration-close
            data-i18n="prod.common.close"></button></div>
        <p id="registration-dialog-status" role="status" aria-live="polite"></p>
        <div id="registration-details"></div>
        <form id="registration-approval-form" class="access-form" hidden>
          <p id="registration-preserved-assignment" hidden></p>
          <div id="registration-assignment-controls">
            <label><span data-i18n="prod.registration.organization"></span>
              <select name="organizationId" required></select></label>
            <fieldset id="registration-roles"><legend data-i18n="prod.access.assignedRoles"></legend></fieldset>
          </div>
          <button type="submit" class="primary-button" id="registration-approve-button"></button>
        </form>
        <div class="dialog-actions" id="registration-dialog-actions"></div>
      </div>
    </dialog>`);

  const $ = (selector) => document.querySelector(selector);
  const listRoot = $("#registration-management");
  const dialog = $("#registration-dialog");
  let items = [];
  let organizations = null;
  let page = 1;
  let total = 0;
  let listRequest = 0;
  let detailRequest = 0;
  let generation = 0;
  let activeDetail = null;
  let busy = false;
  let searchTimer;

  const isSystemAdmin = () => canManageRegistrations(currentUser());
  const writeStatus = (selector, message) => { $(selector).textContent = message; };
  const statusLabel = (status) => t(`prod.registration.${status}`);
  const organizationName = (id) => organizations?.find((org) => org.id === id)?.name ?? "—";

  function renderRows() {
    const body = $("#registrations-body");
    body.innerHTML = items.length ? items.map((item) => {
      const actions = registrationActions(item);
      return `<tr>
        <td>${esc(item.displayName)}</td><td>${esc(item.email)}</td>
        <td>${esc([item.phoneCountry, item.phoneNumber].filter(Boolean).join(" ") || "—")}</td>
        <td>${esc(item.organizationName || organizationName(item.organizationId))}</td>
        <td>${esc(statusLabel(item.status))}</td>
        <td>${esc(t(`prod.registration.delivery.${item.deliveryStatus}`))}</td>
        <td>${esc(formatDateTime(item.createdAt))}</td>
        <td><button type="button" class="secondary-button" data-registration-detail="${esc(item.id)}"
          ${busy ? "disabled" : ""}>${esc(t("prod.registration.details"))}</button>
          ${actions.map((action) => `<button type="button" class="secondary-button"
            data-registration-open-action="${action}" data-registration-id="${esc(item.id)}" ${busy ? "disabled" : ""}>
            ${esc(t(action === "approve" && item.status === "disabled" && item.userId
              ? "prod.registration.reactivate" : `prod.registration.${action}`))}</button>`).join("")}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="8">${esc(t("prod.registration.empty"))}</td></tr>`;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    $("#registration-page").textContent = t("prod.registration.page", { page, pages, total });
    $("#registration-previous").disabled = busy || page <= 1;
    $("#registration-next").disabled = busy || page >= pages;
    $("#registration-reload").disabled = busy;
    $("#registration-search").disabled = busy;
    $("#registration-filter").disabled = busy;
  }

  function renderDetail(registration) {
    $("#registration-dialog-title").textContent = registration.displayName || t("prod.registration.details");
    $("#registration-details").innerHTML = `<dl class="detail-list">
      <div><dt>${esc(t("prod.profile.email"))}</dt><dd>${esc(registration.email)}</dd></div>
      <div><dt>${esc(t("prod.registration.phone"))}</dt><dd>${esc([registration.phoneCountry, registration.phoneNumber].filter(Boolean).join(" ") || "—")}</dd></div>
      <div><dt>${esc(t("prod.common.status"))}</dt><dd>${esc(statusLabel(registration.status))}</dd></div>
      <div><dt>${esc(t("prod.registration.organization"))}</dt><dd>${esc(registration.organizationName || organizationName(registration.organizationId))}</dd></div>
      <div><dt>${esc(t("prod.access.assignedRoles"))}</dt><dd>${esc((registration.roles ?? []).map((role) => labelFor("prod.role", role)).join(", ") || "—")}</dd></div>
      <div><dt>${esc(t("prod.registration.created"))}</dt><dd>${esc(formatDateTime(registration.createdAt))}</dd></div>
      <div><dt>${esc(t("prod.registration.approvedAt"))}</dt><dd>${esc(formatDateTime(registration.approvedAt))}</dd></div>
      <div><dt>${esc(t("prod.registration.activatedAt"))}</dt><dd>${esc(formatDateTime(registration.activatedAt))}</dd></div>
      <div><dt>${esc(t("prod.registration.delivery"))}</dt><dd>${esc(t(`prod.registration.delivery.${registration.deliveryStatus}`))}</dd></div>
      <div><dt>${esc(t("prod.registration.userId"))}</dt><dd>${esc(registration.userId || "—")}</dd></div>
    </dl>`;
    const approvalForm = $("#registration-approval-form");
    const actions = registrationActions(registration);
    const existingAccount = isExistingAccountReactivation(registration);
    approvalForm.hidden = !actions.includes("approve") || (!organizations && !existingAccount);
    if (!approvalForm.hidden) {
      $("#registration-approve-button").textContent = t(
        existingAccount
          ? "prod.registration.reactivate" : "prod.registration.approve",
      );
      $("#registration-assignment-controls").hidden = existingAccount;
      $("#registration-preserved-assignment").hidden = !existingAccount;
      if (existingAccount) {
        $("#registration-preserved-assignment").textContent = t("prod.registration.assignmentPreserved");
      } else {
        approvalForm.elements.organizationId.innerHTML = `<option value="">${esc(t("prod.registration.chooseOrganization"))}</option>`
          + organizations.map((org) => `<option value="${esc(org.id)}">${esc(org.name)}</option>`).join("");
        approvalForm.elements.organizationId.value = registration.organizationId ?? "";
        $("#registration-roles").innerHTML = `<legend>${esc(t("prod.access.assignedRoles"))}</legend>${managedRoles.map((role) => `
          <label class="access-check"><input type="checkbox" name="roles" value="${role}"
            ${(registration.roles ?? []).includes(role) ? "checked" : ""}>${esc(labelFor("prod.role", role))}</label>`).join("")}`;
      }
    }
    const actionRoot = $("#registration-dialog-actions");
    actionRoot.innerHTML = actions.filter((action) => action !== "approve").map((action) => `
      <button type="button" class="${action === "deactivate" ? "danger-button" : "primary-button"}"
        data-registration-dialog-action="${action}">${esc(t(`prod.registration.${action}`))}</button>`).join("");
  }

  async function ensureOrganizations(requestGeneration) {
    if (organizations) return organizations;
    const result = await api("/api/v1/admin/organizations", { organizationScoped: false });
    if (generation !== requestGeneration || !isSystemAdmin()) return null;
    organizations = result;
    return organizations;
  }

  async function load() {
    if (!isSystemAdmin()) {
      listRequest += 1;
      items = [];
      total = 0;
      listRoot.hidden = true;
      return;
    }
    listRoot.hidden = false;
    const request = ++listRequest;
    const requestGeneration = generation;
    const status = $("#registration-filter").value;
    const search = $("#registration-search").value;
    busy = true;
    writeStatus("#registration-status", t("prod.registration.loading"));
    renderRows();
    try {
      const result = await api(registrationListUrl({ status, search, page }), { organizationScoped: false });
      if (request !== listRequest || generation !== requestGeneration || !isSystemAdmin()) return;
      items = result.items;
      total = result.total;
      page = result.page;
      renderRows();
      writeStatus("#registration-status", "");
      return true;
    } catch (error) {
      if (request !== listRequest || generation !== requestGeneration || !isSystemAdmin()) return;
      items = [];
      total = 0;
      renderRows();
      writeStatus("#registration-status", error?.message || t("prod.common.loadFailed"));
      return false;
    } finally {
      if (request === listRequest && generation === requestGeneration) {
        busy = false;
        renderRows();
      }
    }
  }

  async function openDetail(id) {
    if (!isSystemAdmin() || busy) return;
    const request = ++detailRequest;
    const requestGeneration = generation;
    activeDetail = null;
    $("#registration-dialog-title").textContent = t("prod.registration.details");
    $("#registration-details").replaceChildren();
    $("#registration-approval-form").hidden = true;
    $("#registration-dialog-actions").replaceChildren();
    writeStatus("#registration-dialog-status", t("prod.registration.loading"));
    if (!dialog.open) dialog.showModal();
    try {
      const registration = await api(`/api/v1/admin/registrations/${encodeURIComponent(id)}`, {
        organizationScoped: false,
      });
      if (request !== detailRequest || generation !== requestGeneration || !isSystemAdmin()) return;
      activeDetail = registration;
      renderDetail(registration);
      writeStatus("#registration-dialog-status", "");
      if (registrationActions(registration).includes("approve") && !isExistingAccountReactivation(registration)) {
        writeStatus("#registration-dialog-status", t("prod.registration.loading"));
        try {
          await ensureOrganizations(requestGeneration);
          if (request !== detailRequest || generation !== requestGeneration || !isSystemAdmin()) return;
          renderDetail(registration);
          writeStatus("#registration-dialog-status", "");
        } catch (error) {
          if (request === detailRequest && generation === requestGeneration) {
            writeStatus("#registration-dialog-status", error?.message || t("prod.common.loadFailed"));
          }
        }
      }
    } catch (error) {
      if (request !== detailRequest || generation !== requestGeneration || !isSystemAdmin()) return;
      writeStatus("#registration-dialog-status", error?.message || t("prod.common.loadFailed"));
    }
  }

  async function performAction(registration, action, body = {}) {
    if (!isSystemAdmin() || busy || !registration || !registrationActions(registration).includes(action)) return;
    const confirmation = t(`prod.registration.confirm.${action}`, { name: registration.displayName });
    if (!window.confirm(confirmation)) return;
    const requestGeneration = generation;
    busy = true;
    renderRows();
    writeStatus("#registration-dialog-status", t("prod.registration.working"));
    const path = `/api/v1/admin/registrations/${encodeURIComponent(registration.id)}/${action === "approve" ? "approve" : action}`;
    try {
      await api(path, { method: "POST", body, organizationScoped: false });
      if (generation !== requestGeneration || !isSystemAdmin()) return;
      writeStatus("#registration-dialog-status", t("prod.registration.saved"));
      try {
        const refreshed = await refresh();
        if (generation === requestGeneration && isSystemAdmin() && refreshed !== false) {
          writeStatus("#registration-status", t("prod.registration.saved"));
        }
      } catch (error) {
        if (generation === requestGeneration && isSystemAdmin()) {
          const listRefreshed = await load();
          if (generation === requestGeneration && isSystemAdmin()) {
            const listError = listRefreshed ? "" : ` ${t("prod.registration.listRefreshFailed")}`;
            writeStatus("#registration-status",
              `${t("prod.registration.saved")} ${t("prod.registration.refreshFailed")} ${error?.message || ""}${listError}`.trim());
          }
        }
      }
    } catch (error) {
      if (generation === requestGeneration && isSystemAdmin()) {
        writeStatus(dialog.open ? "#registration-dialog-status" : "#registration-status",
          error?.message || t("prod.common.loadFailed"));
      }
    } finally {
      if (generation === requestGeneration) {
        busy = false;
        renderRows();
      }
    }
  }

  $("#registration-filter").addEventListener("change", () => { page = 1; void load(); });
  $("#registration-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page = 1; void load(); }, 250);
  });
  $("#registration-reload").addEventListener("click", () => { void load(); });
  $("#registration-previous").addEventListener("click", () => { if (page > 1) { page -= 1; void load(); } });
  $("#registration-next").addEventListener("click", () => {
    if (page < Math.ceil(total / pageSize)) { page += 1; void load(); }
  });
  $("#registrations-body").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.registrationDetail) {
      void openDetail(button.dataset.registrationDetail);
      return;
    }
    const registration = items.find((item) => item.id === button.dataset.registrationId);
    const action = button.dataset.registrationOpenAction;
    if (action === "approve" && registration) void openDetail(registration.id);
    else if (action && registration) void performAction(registration, action);
  });
  $("#registration-approval-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!activeDetail || !isSystemAdmin()) return;
    const formData = new FormData(event.currentTarget);
    const body = registrationApprovalPayload(activeDetail, {
      organizationId: String(formData.get("organizationId") ?? ""),
      roles: formData.getAll("roles").map(String),
    });
    if (!body.roles.length) {
      writeStatus("#registration-dialog-status", t("prod.access.roleRequired"));
      return;
    }
    if (!body.organizationId) {
      writeStatus("#registration-dialog-status", t("prod.registration.chooseOrganization"));
      return;
    }
    void performAction(activeDetail, "approve", body);
  });
  $("#registration-dialog-actions").addEventListener("click", (event) => {
    const action = event.target.closest("[data-registration-dialog-action]")?.dataset.registrationDialogAction;
    if (action && activeDetail) void performAction(activeDetail, action);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-registration-close]")) dialog.close();
  });
  dialog.addEventListener("close", () => {
    detailRequest += 1;
    activeDetail = null;
  });

  return {
    load,
    render() {
      listRoot.hidden = !isSystemAdmin();
      if (isSystemAdmin()) renderRows();
      else if (dialog.open) dialog.close();
    },
    invalidate() {
      generation += 1;
      listRequest += 1;
      detailRequest += 1;
      clearTimeout(searchTimer);
      activeDetail = null;
      busy = false;
      items = [];
      total = 0;
      organizations = null;
      page = 1;
      if (dialog.open) dialog.close();
      listRoot.hidden = true;
      $("#registrations-body").replaceChildren();
      writeStatus("#registration-status", "");
      writeStatus("#registration-dialog-status", "");
    },
  };
}
