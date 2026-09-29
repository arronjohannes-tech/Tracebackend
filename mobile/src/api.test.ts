import assert from "node:assert/strict";
import test from "node:test";
import { configureApiSession, getCurrentAuthHeaders, login, refreshSession, ApiError } from "./api";

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
