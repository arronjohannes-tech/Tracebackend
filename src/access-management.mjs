const organizationRoles = ["org_admin", "reviewer", "field_agent", "auditor"];

export function assignableUserRoles(actor) {
  return actor?.role === "system_admin" ? ["system_admin", ...organizationRoles] : [...organizationRoles];
}

export function isProtectedSystemUser(user) {
  return user?.role === "system_admin" || user?.roles?.includes("system_admin") === true;
}

export function selectUserRoles(selected, changedRole, checked) {
  if (!checked) return selected.filter((role) => role !== changedRole);
  if (changedRole === "system_admin") return ["system_admin"];
  return [...new Set([...selected.filter((role) => role !== "system_admin"), changedRole])];
}

export function initAccessManagement({ api, t, labelFor, escapeHtml: esc, canRead, canEdit, currentUser, refresh, reauthenticate }) {
  const sections = ["overview", "suppliers", "plots", "shipments", "risk", "dds", "guide", "users", "roles"];
  let users = [];
  let matrix = null;
  let editing = null;
  const title = (section) => t(`prod.access.section.${section}`);
  const nav = document.querySelector("aside nav");
  nav.insertAdjacentHTML("beforeend", ["users", "roles"].map((section, index) =>
    `<a class="nav-link" href="#${section}" data-view="${section}"><span>0${index + 8}</span><span data-i18n="prod.access.section.${section}"></span></a>`).join(""));
  document.querySelector("main").insertAdjacentHTML("beforeend", `
    <section class="view" id="users" data-title-key="prod.access.section.users">
      <div class="panel"><div class="panel-heading"><h2 data-i18n="prod.access.section.users"></h2>
        <button type="button" class="primary-button" id="user-create" data-i18n="prod.access.create"></button></div>
        <div class="access-filters"><label><span data-i18n="prod.access.search"></span><input id="user-search" type="search"></label>
          <label><span data-i18n="prod.common.status"></span><select id="user-filter"><option value="" data-i18n="prod.access.all"></option>
          <option value="active" data-i18n="prod.access.active"></option><option value="inactive" data-i18n="prod.access.inactive"></option></select></label></div>
        <p data-i18n="prod.registration.visibility"></p>
        <p id="users-status" role="status" aria-live="polite"></p>
        <div class="table-wrap"><table><thead><tr><th data-i18n="prod.profile.name"></th><th data-i18n="prod.profile.email"></th>
          <th data-i18n="prod.access.assignedRoles"></th><th data-i18n="prod.common.status"></th><th data-i18n="prod.access.actions"></th></tr></thead>
          <tbody id="users-body"></tbody></table></div></div>
    </section>
    <section class="view" id="roles" data-title-key="prod.access.section.roles">
      <div class="panel"><h2 data-i18n="prod.access.section.roles"></h2><p data-i18n="prod.access.policy"></p>
        <form id="role-permissions-form"><div id="role-matrix" class="table-wrap"></div>
          <p id="roles-status" role="status" aria-live="polite"></p>
          <button type="submit" class="primary-button" data-i18n="prod.common.save"></button></form></div>
    </section>
    <dialog id="managed-user-dialog"><form id="managed-user-form" class="access-form">
      <h2 id="managed-user-title"></h2><p id="managed-user-id"></p>
      <label><span data-i18n="prod.profile.name"></span><input name="displayName" required maxlength="120"></label>
      <label><span data-i18n="prod.login.email"></span><input name="email" type="email" required></label>
      <label><span data-i18n="prod.access.password"></span><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="1024"></label>
      <fieldset id="managed-user-roles"><legend data-i18n="prod.access.assignedRoles"></legend></fieldset>
      <label><input name="active" type="checkbox"><span data-i18n="prod.access.active"></span></label>
      <p id="managed-user-status" role="status" aria-live="polite"></p>
      <div class="dialog-actions"><button type="button" class="secondary-button" data-dialog-close data-i18n="prod.common.close"></button>
        <button type="submit" class="primary-button" data-i18n="prod.common.save"></button></div>
    </form></dialog>`);
  const $ = (selector) => document.querySelector(selector);
  const status = (id, message) => { $(id).textContent = message; };
  const errorMessage = (error) => error?.message || t("prod.common.loadFailed");
  function renderUsers() {
    const search = $("#user-search").value.toLowerCase();
    const filter = $("#user-filter").value;
    $("#user-create").hidden = !canEdit("users");
    const visible = users.filter((user) =>
      `${user.displayName} ${user.email}`.toLowerCase().includes(search)
      && (!filter || user.active === (filter === "active")));
    $("#users-body").innerHTML = visible.length ? visible.map((user) => `<tr>
      <td>${esc(user.displayName)}</td><td>${esc(user.email)}</td>
      <td>${(user.roles ?? [user.role]).map((role) => esc(labelFor("prod.role", role))).join(", ")}</td>
      <td>${esc(t(user.active ? "prod.access.active" : "prod.access.inactive"))}</td>
      <td><button type="button" class="secondary-button" data-user-edit="${esc(user.id)}">${esc(t("prod.access.details"))}</button>
        ${canEdit("users") && !isProtectedSystemUser(user) && user.id !== currentUser()?.id ? `
          <button type="button" class="secondary-button" data-user-toggle="${esc(user.id)}">${esc(t(user.active ? "prod.access.deactivate" : "prod.access.activate"))}</button>
          <button type="button" class="danger-button" data-user-delete="${esc(user.id)}">${esc(t("prod.common.delete"))}</button>` : ""}</td></tr>`).join("")
      : `<tr><td colspan="5">${esc(t("prod.common.empty"))}</td></tr>`;
  }
  function renderRoles() {
    if (!matrix) return;
    $("#role-matrix").innerHTML = `<table><thead><tr><th>${esc(t("prod.profile.role"))}</th>
      ${sections.map((section) => `<th>${esc(title(section))}</th>`).join("")}</tr></thead><tbody>
      ${matrix.roles.map((role) => `<tr><th>${esc(labelFor("prod.role", role))}</th>${sections.map((section) => {
        const row = matrix.permissions.find((entry) => entry.role === role && entry.section === section);
        const disabled = row.locked || !canEdit("roles");
        return `<td>${["read", "write"].map((action) => `<label class="access-check">
          <input type="checkbox" data-role="${role}" data-section="${section}" data-permission="${action}"
            ${row[action] ? "checked" : ""} ${disabled ? "disabled" : ""}
            aria-label="${esc(`${labelFor("prod.role", role)}: ${title(section)} - ${t(`prod.access.${action}`)}`)}">
          ${esc(t(`prod.access.${action}`))}</label>`).join("")}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table>`;
    $("#role-permissions-form button[type=submit]").hidden = !canEdit("roles");
  }
  function openUser(user = null) {
    editing = user;
    const form = $("#managed-user-form");
    form.reset();
    $("#managed-user-title").textContent = t(user ? "prod.access.details" : "prod.access.create");
    $("#managed-user-id").textContent = user ? `ID: ${user.id}` : "";
    form.elements.displayName.value = user?.displayName ?? "";
    form.elements.email.value = user?.email ?? "";
    form.elements.password.required = !user;
    form.elements.active.checked = user?.active ?? true;
    const roleNames = assignableUserRoles(currentUser());
    if (isProtectedSystemUser(user) && !roleNames.includes("system_admin")) roleNames.unshift("system_admin");
    $("#managed-user-roles").innerHTML = `<legend>${esc(t("prod.access.assignedRoles"))}</legend>${roleNames.map((role) =>
      `<label class="access-check"><input type="checkbox" name="roles" value="${role}"
      ${(user?.roles ?? [user?.role]).includes(role) ? "checked" : ""}>${esc(labelFor("prod.role", role))}</label>`).join("")}`;
    const writable = canEdit("users") && !isProtectedSystemUser(user);
    for (const control of form.querySelectorAll("input")) control.disabled = !writable;
    if (user?.id === currentUser()?.id) {
      form.elements.active.disabled = true;
      for (const input of form.querySelectorAll('[name="roles"]')) input.disabled = true;
    }
    form.querySelector('[type="submit"]').hidden = !writable;
    status("#managed-user-status", isProtectedSystemUser(user) ? t("prod.access.systemProtected")
      : currentUser()?.role === "system_admin" ? t("prod.access.systemExclusive") : "");
    $("#managed-user-dialog").showModal();
  }
  $("#user-search").addEventListener("input", renderUsers);
  $("#user-filter").addEventListener("change", renderUsers);
  $("#user-create").addEventListener("click", () => { if (canEdit("users")) openUser(); });
  $("#managed-user-roles").addEventListener("change", (event) => {
    const input = event.target.closest('[name="roles"]');
    if (!input || input.disabled || !canEdit("users") || isProtectedSystemUser(editing)) return;
    const controls = [...$("#managed-user-roles").querySelectorAll('[name="roles"]')];
    const selected = selectUserRoles(controls.filter((control) => control.checked).map((control) => control.value),
      input.value, input.checked);
    for (const control of controls) control.checked = selected.includes(control.value);
  });
  $("#users-body").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const id = button.dataset.userEdit ?? button.dataset.userToggle ?? button.dataset.userDelete;
    const user = users.find((item) => item.id === id);
    if (!user) return;
    if (button.dataset.userEdit) { openUser(user); return; }
    if (!canEdit("users") || isProtectedSystemUser(user)) return;
    if (button.dataset.userDelete && !confirm(t("prod.access.deleteConfirm", { name: user.displayName }))) return;
    button.disabled = true;
    try {
      await api(`/api/v1/admin/users/${encodeURIComponent(id)}`, button.dataset.userDelete
        ? { method: "DELETE" } : { method: "PATCH", body: { active: !user.active } });
      await refresh();
      status("#users-status", t("prod.access.saved"));
    } catch (error) { status("#users-status", errorMessage(error)); }
    finally { button.disabled = false; }
  });
  $("#managed-user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canEdit("users") || isProtectedSystemUser(editing)) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const selected = data.getAll("roles");
    const ownAccount = editing?.id === currentUser()?.id;
    if (!ownAccount && !selected.length) { status("#managed-user-status", t("prod.access.roleRequired")); return; }
    const body = { email: String(data.get("email")), displayName: String(data.get("displayName")),
      ...(ownAccount ? {} : { roles: selected, active: data.has("active") }),
      ...(data.get("password") ? { password: String(data.get("password")) } : {}) };
    const needsLogin = ownAccount && (body.email.toLowerCase() !== editing.email || Boolean(body.password));
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api(`/api/v1/admin/users${editing ? `/${encodeURIComponent(editing.id)}` : ""}`, {
        method: editing ? "PATCH" : "POST", body,
      });
      form.reset();
      $("#managed-user-dialog").close();
      if (needsLogin) { reauthenticate(); return; }
      await refresh();
      status("#users-status", t("prod.access.saved"));
    } catch (error) { status("#managed-user-status", errorMessage(error)); }
    finally { submit.disabled = false; }
  });
  $("#role-matrix").addEventListener("change", (event) => {
    const input = event.target.closest("[data-permission]");
    if (!input || !canEdit("roles")) return;
    const row = matrix.permissions.find((entry) => entry.role === input.dataset.role && entry.section === input.dataset.section);
    if (row.locked) return;
    row[input.dataset.permission] = input.checked;
    if (input.dataset.permission === "write" && input.checked) row.read = true;
    if (input.dataset.permission === "read" && !input.checked) row.write = false;
    renderRoles();
  });
  $("#role-permissions-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canEdit("roles") || !matrix) return;
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api("/api/v1/admin/roles", { method: "PUT", body: { permissions: matrix.permissions
        .filter((entry) => entry.role !== "system_admin")
        .map(({ role, section, read, write }) => ({ role, section, read, write })) } });
      await refresh();
      status("#roles-status", t("prod.access.saved"));
    } catch (error) { status("#roles-status", errorMessage(error)); }
    finally { submit.disabled = false; }
  });
  return {
    async load() {
      users = [];
      matrix = null;
      await Promise.all([
        canRead("users") ? api("/api/v1/admin/users").then((result) => { users = result; }) : Promise.resolve(),
        canRead("roles") ? api("/api/v1/admin/roles").then((result) => { matrix = result; }) : Promise.resolve(),
      ]);
    },
    render() { renderUsers(); renderRoles(); },
    clear() { users = []; matrix = null; $("#users-body").replaceChildren(); $("#role-matrix").replaceChildren(); },
  };
}
