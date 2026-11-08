import test from "node:test";
import assert from "node:assert/strict";
import { initPasswordRecovery } from "../src/password-recovery.mjs";

function element(fields = []) {
  const handlers = new Map();
  const button = { disabled: false };
  return {
    hidden: false,
    textContent: "",
    elements: Object.fromEntries(fields.map((name) => [name, { value: "" }])),
    insertAdjacentHTML() {},
    addEventListener(event, handler) { handlers.set(event, handler); },
    querySelector() { return button; },
    reset() { Object.values(this.elements).forEach((field) => { field.value = ""; }); },
    async emit(event) { await handlers.get(event)?.({ preventDefault() {} }); },
  };
}

test("password recovery handles initial and same-document reset links", async (context) => {
  const globals = ["document", "window", "location", "history", "sessionStorage", "fetch"];
  const original = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  context.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const login = element(["email", "organizationSlug"]);
  const forgot = element(["email", "organizationSlug"]);
  const reset = element(["password", "confirmation"]);
  const toggle = element();
  const status = element();
  const back = element();
  const nodes = new Map([
    ["#tracehub-login-form", login], ["#forgot-password-form", forgot],
    ["#reset-password-form", reset], ["#forgot-password", toggle], ["#auth-status", status],
  ]);
  const events = element();
  const requests = [];
  let sessionClears = 0;
  let resetTransitions = 0;
  Object.assign(globalThis, {
    document: { querySelector: (selector) => nodes.get(selector), querySelectorAll: () => [back] },
    window: events,
    location: { hash: "#reset-password?token=initial-token", pathname: "/index-prod.html", search: "?lang=de" },
    history: { replaceState(_state, _title, url) {
      assert.equal(url, "/index-prod.html?lang=de");
      location.hash = "";
    } },
    sessionStorage: { clear() { sessionClears++; } },
    fetch: async (path, options) => {
      requests.push({ path, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ data: { reset: true } }) };
    },
  });
  const recovery = initPasswordRecovery({
    t: (key) => key,
    onReset: () => { resetTransitions++; },
  });
  assert.equal(recovery.isResetting(), true);
  assert.equal(reset.hidden, false);
  assert.equal(login.hidden, true);
  assert.equal(location.hash, "");
  assert.equal(resetTransitions, 1);
  await back.emit("click");
  assert.equal(recovery.isResetting(), false);
  await toggle.emit("click");
  assert.equal(forgot.hidden, false);
  location.hash = "#reset-password?token=same-document-token";
  await events.emit("hashchange");
  assert.equal(reset.hidden, false);
  assert.equal(forgot.hidden, true);
  assert.equal(location.hash, "");
  assert.equal(resetTransitions, 2);
  reset.elements.password.value = "replacement-password-123";
  reset.elements.confirmation.value = "mismatched-password-123";
  await reset.emit("submit");
  assert.equal(status.textContent, "prod.reset.mismatch");
  assert.equal(requests.length, 0);
  reset.elements.confirmation.value = reset.elements.password.value;
  await reset.emit("submit");
  assert.deepEqual(requests, [{
    path: "/api/v1/auth/reset-password",
    body: { token: "same-document-token", password: "replacement-password-123" },
  }]);
  assert.equal(recovery.isResetting(), false);
  assert.equal(login.hidden, false);
  assert.equal(reset.hidden, true);
  assert.equal(reset.elements.password.value, "");
  assert.equal(status.textContent, "prod.reset.success");
  assert.equal(sessionClears, 3);
});
