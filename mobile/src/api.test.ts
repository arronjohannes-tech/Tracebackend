import assert from "node:assert/strict";
import test from "node:test";
import { activateAccount, registerAccount, configureApiSession, getCurrentAuthHeaders, login, refreshSession, ApiError } from "./api";

test("registration and activation use public endpoints without stale auth and activate before login", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = "https://mobile.test";
  const calls: { url: string; body: unknown; headers: Headers }[] = [];
  configureApiSession(null, () => undefined);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    if (url.endsWith("/registrations")) return Response.json({ data: { message: "Neutral" } }, { status: 202 });
    if (url.endsWith("/activate")) return Response.json({ data: { message: "Activated", email: "approved@example.com" } });
    return Response.json({ data: {
      accessToken: "access", refreshToken: "refresh", expiresIn: 300,
      user: { id: "approved", email: "approved@example.com" },
      organizations: [{ id: "assigned-org", name: "Assigned" }],
    } });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    configureApiSession(null, () => undefined);
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });
  const registration = { displayName: "Example", email: "request@example.com", phoneCountry: "DE", phoneNumber: "+4915123456789" };
  assert.deepEqual(await registerAccount(registration), { message: "Neutral" });
  const activated = await activateAccount("test-token", "initial-password");
  await login(activated.email, "initial-password");
  assert.deepEqual(calls.map(({ url }) => url), [
    "https://mobile.test/api/v1/auth/registrations",
    "https://mobile.test/api/v1/auth/activate",
    "https://mobile.test/api/v1/auth/login",
  ]);
  assert.deepEqual(calls.map(({ body }) => body), [
    registration, { token: "test-token", password: "initial-password" },
    { email: "approved@example.com", password: "initial-password" },
  ]);
  for (const { headers } of calls) {
    assert.equal(headers.has("Authorization"), false);
    assert.equal(headers.has("X-Organization-Id"), false);
  }
  globalThis.fetch = async () => Response.json({
    error: { code: "INVALID_ACTIVATION_TOKEN", message: "Invalid" },
  }, { status: 400 });
  await assert.rejects(activateAccount("expired", "password"), (reason: unknown) =>
    reason instanceof ApiError && reason.code === "INVALID_ACTIVATION_TOKEN");
});

test("a link-driven session reset prevents in-flight login from establishing a stale session", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = "https://mobile.test";
  let respond!: (response: Response) => void;
  const changes: unknown[] = [];
  configureApiSession(null, (session) => { changes.push(session); });
  globalThis.fetch = () => new Promise((resolve) => { respond = resolve; });
  t.after(() => {
    globalThis.fetch = originalFetch;
    configureApiSession(null, () => undefined);
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });
  const pending = login("old@example.com", "password");
  configureApiSession(null, (session) => { changes.push(session); });
  respond(Response.json({ data: {
    accessToken: "old", refreshToken: "old-refresh", expiresIn: 300,
    user: { id: "old", email: "old@example.com" }, organizations: [],
  } }));
  await assert.rejects(pending, (reason: unknown) => reason instanceof ApiError && reason.code === "AUTH_SCOPE_CHANGED");
  assert.deepEqual(changes, []);
});

test("login forwards the optional organization slug", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = "https://mobile.test";
  let requestBody: unknown;

  configureApiSession(null, () => undefined);
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      data: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresIn: 300,
        user: { id: "user-1", email: "field@example.com" },
        organizations: [{ id: "org-1", name: "Organization" }],
        selectedOrganizationId: "org-1",
      },
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    configureApiSession(null, () => undefined);
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  await login("field@example.com", "secret", "coffee-cooperative");

  assert.deepEqual(requestBody, {
    email: "field@example.com",
    password: "secret",
    organizationSlug: "coffee-cooperative",
  });
  assert.deepEqual(await getCurrentAuthHeaders(), {
    Authorization: "Bearer access",
    "X-Organization-Id": "org-1",
  });
  await assert.rejects(
    () => getCurrentAuthHeaders({ userId: "user-1", organizationId: "org-2" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_SCOPE_CHANGED",
  );
});

test("transient refresh failures preserve the session and revoked tokens clear it", async t=>{
 const oldFetch=globalThis.fetch,oldUrl=process.env.EXPO_PUBLIC_API_URL;
 process.env.EXPO_PUBLIC_API_URL="https://mobile.test";
 const session={accessToken:"old",refreshToken:"refresh",accessTokenExpiresAt:new Date(0).toISOString(),user:{id:"u",email:"u@example.com"},organizations:[{id:"o",name:"O"}],selectedOrganizationId:"o"};
 const events: unknown[]=[];
 configureApiSession(session,next=>{events.push(next);});
 t.after(()=>{globalThis.fetch=oldFetch;configureApiSession(null,()=>undefined);if(oldUrl===undefined)delete process.env.EXPO_PUBLIC_API_URL;else process.env.EXPO_PUBLIC_API_URL=oldUrl;});
 globalThis.fetch=async()=>{throw new TypeError("Network unavailable");};
 await assert.rejects(refreshSession);
 assert.deepEqual(events,[]);
 globalThis.fetch=async()=>Response.json({error:{code:"INTERNAL_ERROR",message:"Unavailable"}},{status:503});
 await assert.rejects(refreshSession);
 assert.deepEqual(events,[]);
 globalThis.fetch=async()=>Response.json({error:{code:"INVALID_REFRESH_TOKEN",message:"Revoked"}},{status:401});
 await assert.rejects(refreshSession);
 assert.deepEqual(events,[null]);
});
