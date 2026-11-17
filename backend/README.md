# SCTracker Backend

TypeScript/Fastify API for PostgreSQL 15+ with PostGIS. Every tenant-owned table has
row-level security and every application query runs in a transaction with
`app.current_organization`. Mutations relevant to compliance are written to the
append-only audit log.

## Local setup

```powershell
Copy-Item .env.example .env
# Set DATABASE_URL, JWT_SECRET, CONFIG_ENCRYPTION_KEY and bootstrap credentials.
npm install
npm run migrate
npm run dev
```

The migration requires a PostgreSQL role allowed to install `postgis` and `pgcrypto`.
The migration runner establishes the session-level system RLS context before it
executes the migration lock, migration metadata, or migration SQL. This is required
when later migrations update tenant-protected tables through a normal application
database role.
After the first migration, remove `BOOTSTRAP_ADMIN_PASSWORD` from `.env`. The static
admin SPA is served at `http://127.0.0.1:4300/admin/`.

If the admin SPA is hosted on a different origin than the API, set
`<meta name="tracebackend-api-base-url" content="https://your-backend.example.com">`
in `admin/index.html`. Without this, the SPA calls `/api/...` on its own origin.

## Provisioned Neon database

The dedicated `sctracker_asteros` database is provisioned in the existing Neon
`sctracker` project on AWS Frankfurt (`aws-eu-central-1`). It contains all
migrations through `003_dds_idempotency_and_plot_geofence.sql`, including
PostGIS, row-level security, audit logging, geofencing, and DDS reconciliation.

Copy the pooled connection string for `sctracker_asteros` from the Neon console
into `DATABASE_URL` in the local `.env`; never commit that value. The initial
system administrator is `arron.johannes@googlemail.com`. Its generated initial
password is stored only in the ignored local `.bootstrap-admin-password` file.

## Vercel deployment

Configure the Vercel project with `backend` as its root directory and the Fastify
framework preset. `npm run build` uses `tsconfig.build.json` to compile application
sources only; `npm run typecheck` also checks tests, including the Windows-specific
integration harness. Deployment ignore files exclude local environment files,
credentials, certificates and generated artifacts from CLI uploads.
The production environment requires:

- `DATABASE_URL`: pooled Neon connection string for `sctracker_asteros`
- `DATABASE_SSL=true`
- `JWT_SECRET`: random value of at least 32 characters
- `CONFIG_ENCRYPTION_KEY`: random 32-byte value encoded as base64
- `PUBLIC_BASE_URL`: public HTTPS URL of the backend
- `ADMIN_ORIGIN`: public HTTPS origin allowed to use the administration SPA
- `NODE_ENV=production`
- `TRACEHUB_BASE_URL`: public HTTPS origin of the Tracehub frontend (registration link)
- `RESEND_API_KEY` and `INVITATION_FROM_EMAIL`: Resend API key and verified sender address for transactional email (supplier invitations and password resets)

Apply migrations `005_supplier_invitations.sql`, `006_shipments.sql`, `007_copernicus_process.sql`, `008_plot_corrections.sql` and `014_plot_geometry_versions.sql` with `npm run migrate` before deploying
the invitation endpoints. The invitation endpoint returns `MAIL_NOT_CONFIGURED`
until both mail settings are present. Invitations expire after seven days; only
token hashes are stored, and a link can be used once. The registration page is
served by the Tracehub frontend at `/register.html`, not by the backend.

Password reset uses the same Resend configuration (`RESEND_API_KEY` and
`INVITATION_FROM_EMAIL`) and the `TRACEHUB_BASE_URL` frontend origin. Apply
`011_password_reset.sql` with `npm run migrate` before enabling the password
reset endpoints. If the email provider is not configured or delivery fails,
forgot-password returns `503 MAIL_UNAVAILABLE`; it does not report a successful
request. The email link is
`{TRACEHUB_BASE_URL}/index-prod.html#reset-password?token=<urlencoded-token>`;
the frontend reads the token from the `reset-password` fragment route.
`TRACEHUB_BASE_URL` must be the frontend origin that serves this page.
Forgot-password is limited to five requests per minute per client IP and
reset-password to ten requests per minute.
Failed delivery logs only a classified cause and the provider HTTP status, never
the provider response body, API key, recipient address or reset link. Check Vercel
runtime logs for `Account email delivery failed` when Resend rejects mail
(`Password reset email delivery failed` identifies missing reset configuration).

### Mobile registration and first password

Migration `012_mobile_registration.sql` adds the system-only, forced-RLS
registration inbox and optional phone fields on users. Existing accounts remain
unchanged. Public `POST /api/v1/auth/registrations` accepts `displayName`, `email`,
`phoneCountry` (ISO country code) and `phoneNumber`, validates international phone
metadata, and returns a neutral 202 response for new, duplicate and existing
accounts. Repeated submissions never replace contact details or security state.
The phone number is normalized to E.164, not verified by SMS.

Only system administrators can list or inspect `/api/v1/admin/registrations`,
or call its `/:id/approve`, `/:id/resend` and `/:id/deactivate` actions.
Approval assigns an active organization and managed roles; it does not create
a usable account. Activation emails use the configured Resend sender and
`TRACEHUB_BASE_URL/mobile-activate.html#token=...`. Tokens are hashed, expire in
24 hours, are replaced on resend, and are invalidated on failed delivery or
deactivation. Mail acceptance is not a guarantee of inbox delivery.

`POST /api/v1/auth/activate` accepts `token` and `password` (12–1024 characters).
It locks and checks the approved registration, creates the user, and consumes
the token in one transaction. It returns an email for regular login, not a
session. Deactivation revokes sessions, uploads and reset links. Reactivating
an existing non-deleted account preserves its password and existing roles.
Existing self-access and last-active-admin guards apply.

See [registration activation](../docs/registration-activation.md) for native
builds, HTTPS association requirements and the explicit app-opening fallback.

Vercel supplies `PORT` automatically. The server binds to all interfaces and uses
`/tmp/sctracker-storage` when `STORAGE_DIR` is not set. Vercel's local filesystem
is ephemeral, so document and evidence files require durable object storage before
using those workflows in production.

## Authentication and authorization

- Passwords use Argon2id (64 MiB, 3 iterations).
- HS256 access JWTs default to 15 minutes and contain user, role, tenant, and token
  version claims.
- Opaque 256-bit refresh tokens are stored only as SHA-256 hashes, rotate on every
  use, and belong to a revocable token family.
- Roles: `system_admin`, `org_admin`, `reviewer`, `field_agent`, `auditor`.
- Accounts can have multiple roles. The primary role remains in the JWT for
  compatibility; assigned roles and section permissions are read from the database
  on each authenticated request, never accepted from the browser.
- Pass `Authorization: Bearer <accessToken>` on all protected routes.
- Success: `{ "data": ... }`; error:
  `{ "error": { "code": "...", "message": "...", "details": ... } }`.

### Tracehub user and role administration

Apply all pending numbered migrations with `npm run migrate` **before** deploying
the updated backend and frontend. `010_user_permissions.sql` backfills existing
accounts with their current role; `011_password_reset.sql` adds reset tokens.
These migrations are not applied automatically by a deployment.

The productive frontend adds **User management** and **Role management** for
`org_admin` and `system_admin`. Organization administrators can manage only their
own organization. System administrators select an organization before managing
its users; global system-administrator accounts are not editable here.

- Only an existing `system_admin` can assign `system_admin` when creating a user
  or changing a non-system user's roles. It grants cross-organization access and
  must be assigned alone. Assigning this role clears the account's organization
  to match the global-account database constraint; the account then disappears
  from the organization-scoped list. Existing system-administrator accounts remain
  read-only here, and registration deactivation cannot remove their access.
  Mobile registration approval still excludes `system_admin`. No migration is
  needed for this assignment option.
- User creation, details, name/email/password edits, activation/deactivation,
  multiple-role assignment, search, and soft deletion are supported.
- Soft deletion retains audit history and reserves the email within that
  organization; deleted accounts are excluded from login, refresh and reset.
- Self deletion/deactivation and self role changes are blocked. Organization-row
  locking protects the last active organization administrator, including
  concurrent changes.
- Changing email, password, roles or active status revokes access/refresh sessions
  and outstanding document-upload authorizations. Name-only changes do not revoke
  sessions. Editing one's own email/password returns the frontend to sign-in.
- The five existing roles are fixed; this feature manages assignments and rights,
  not custom role creation. Permissions combine as the union of the user's roles.
- Per-organization **View / Edit** rights cover overview, suppliers, plots,
  shipments, risk/evidence, DDS, guide, users and roles. Edit implies View.
  Administration cannot be assigned to non-administrators or removed from
  organization administrators. System-administrator permissions are protected.
- Missing overrides preserve existing rights. Business-specific safeguards
  (for example, who may submit DDS or delete shipments) still apply.
- The API rejects forbidden section access. Combined dashboard/organization
  responses remove unauthorized records/counts. Non-secret feature flags remain
  available to render satellite/DDS actions. Upload content rechecks the owner's
  current rights even when the request uses an upload token.
- Permission changes apply to the next API request; the frontend reloads its
  navigation and data on workspace refresh. Offline sync push checks each entity;
  sync pull currently requires both supplier and plot View rights to preserve its
  shared cursor contract.

Forgot-password/reset is public and uses the existing Resend settings described
above. Only token hashes are stored. Tokens expire after one hour, are consumed
transactionally, and become invalid after security-relevant account changes.
The frontend handles reset links on initial load and navigation in an already
open tab, clears the current session, and immediately removes the token fragment
from the address bar. A successful reset revokes access/refresh sessions and
outstanding uploads; inactive/deleted users cannot reset their passwords.

Focused validation: `node --import tsx --test test/permissions.test.ts
test/access-integration.test.ts test/password-reset.test.ts`. The isolated
PostgreSQL integration test runs on Windows using the existing embedded-Postgres
dependency, covers migrations 010/011 on minimal tables, tenant RLS, lifecycle,
last-admin concurrency and reset expiry/single-use. It never connects to
production and does not validate the full PostGIS schema.

## API contract

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/auth/login` | `{email,password,organizationSlug?}` → tokens, user, organizations, selected organization |
| POST | `/api/v1/auth/refresh` | Rotate `{refreshToken}` and return the same organization selection fields |
| POST | `/api/v1/auth/logout` | Revoke supplied refresh token |
| GET | `/api/v1/auth/me` | Current principal |
| GET/POST | `/api/v1/admin/users` | Organization-scoped user list/create; create accepts `{email,displayName,password,roles,active?}` |
| PATCH/DELETE | `/api/v1/admin/users/:userId` | Edit account or soft-delete it; administrators only, last-admin/self-access protections |
| GET/PUT | `/api/v1/admin/roles` | Read/save complete per-organization role matrix: `{permissions:[{role,section,read,write}]}`; system admin selects `?organizationId=` |
| POST | `/api/v1/auth/forgot-password` | Public `{email,organizationSlug?}` → `202 {"data":{"message":"If an active account matches those details, password reset instructions will be sent."}}` whether a matching account exists or not; sends a one-hour, single-use link when eligible |
| POST | `/api/v1/auth/reset-password` | Public `{token,password}` (password: 12–1024 chars) → `200 {"data":{"reset":true}}`; invalid, expired, used, inactive, or deleted-account tokens return `400 INVALID_RESET_TOKEN` |
| POST | `/api/v1/supplier-invitations` | Authenticated organization administrator: `{legalName,email,organizationId?}`; sends a registration link |
| POST | `/api/v1/supplier-invitations/resolve` | Public `{token}`; validates link and returns invited organization, supplier name and email |
| POST | `/api/v1/supplier-invitations/register` | Public `{token,legalName,tradingName,registrationNumber,taxId,countryCode,region,streetAddress,city,postalCode,contactName,contactPhone,website,password}`; creates supplier and field-agent account and returns a login session |
| GET | `/api/v1/dashboard` | Tracehub overview: counts plus suppliers, plots, operations, documents and reviews of the organization (system administrators pass `?organizationId=`) |
| GET | `/api/v1/organization` | Organization details with counts, API-feature flags and, for administrators, members |
| GET/POST | `/api/v1/shipments` | List or create shipments; create needs `system_admin`, `org_admin` or `reviewer` |
| GET/PATCH/DELETE | `/api/v1/shipments/:id` | Show, partially update (reviewer and up) or delete (administrators only) a shipment |
| GET | `/api/v1/plots` | Plots with GeoJSON polygon, centroid and computed validation (geofence, plausible area, self-intersection, duplicate, EO analysis) plus the number of open corrections |
| GET/PUT | `/api/v1/admin/organizations/:organizationId/google-maps` | Organization/system administrators only. GET returns `{enabled,hasApiKey}` without the key. PUT accepts `{enabled,apiKey?}`; omitted key preserves it, `null` clears it while disabled. Requires migration 015; keys are encrypted with `CONFIG_ENCRYPTION_KEY`, and audit details exclude their values. |
| GET | `/api/v1/plots/google-maps-config` | Authenticated plot-read access in the selected organization. Returns `{enabled,apiKey}` for browser SDK initialization (`apiKey:null` when disabled), with `Cache-Control: private, no-store`. This is a restricted browser key, not a server-only secret: enforce Website/API restrictions and billing quotas in Google Cloud. |
| GET | `/api/v1/plots/satellite-background?bbox=west,south,east,north&size=1024` | Unclipped true-colour Sentinel-2 image (Copernicus Process API) for a bounding box of at most 0.1°, as `{bbox,contentType,image(base64),from,to}`. Optional longest-side `size`: 256, 512, 1024 (default), or 2048 pixels. Needs the organization's Copernicus configuration (`409 SATELLITE_NOT_CONFIGURED` otherwise); cache keys include organization, weekly interval, bbox and size. Concurrent identical requests share one provider call within each backend instance; failed calls can be retried. Optional `comparison=baseline\|current` requires tenant activation, returns PNG with `projection:"EPSG:3857"` (bbox remains WGS84), and checks acquisition availability through Catalog API. Baseline is only 2020-12-31 UTC; current uses most-recent mosaicking in the configured lookback (minimum 60 days). No matching acquisition: `404 SATELLITE_NO_IMAGERY`, without a substitute period. No-data pixels are opaque grey. Comparison cache keys are separate; historical keys are date-fixed rather than weekly. |
| GET | `/api/v1/plots/map-comparison-config` | Authenticated, tenant-scoped `{enabled}` with plots read permission and private/no-store caching. Defaults to false. |
| GET | `/api/v1/plots/:id/versions` | All stored GeoJSON versions of a plot (newest first); the captured geometry is always listed as the current version if it was never edited in Tracehub |
| PUT | `/api/v1/plots/:id/geometry` | `{polygon,baseRevision,note?}` (writers only): stores the manually adjusted polygon as a new version, raises `plots.revision`, re-evaluates the geofence, recomputes `area_ha`, moves matching GPS track points and queues a sync change so the mobile app pulls it. `409 PLOT_REVISION_CONFLICT` when the plot changed meanwhile, `422 INVALID_GEOMETRY` for self-intersecting polygons |
| GET/POST | `/api/v1/plot-corrections` | List (`?status=&plotId=`) or create correction requests; create needs `system_admin`, `org_admin` or `reviewer`. Body: `{scope:"plot",plotId}`, `{scope:"group",groupType:"supplier"\|"producer",groupKey}` or `{scope:"all"}`, plus `category` and `message` |
| GET/PATCH | `/api/v1/plot-corrections/:id` | Show a request or close it as a whole (`{status:"resolved"\|"cancelled",note?}`) |
| PATCH | `/api/v1/plot-corrections/:id/plots/:plotId` | Close the correction of a single plot; the request closes automatically once no plot is open |
| GET | `/api/v1/geofences` | Active geofences for the authenticated organization |
| POST | `/api/v1/sync/push` | Mobile `{deviceId,operations[]}`; returns accepted/conflicts |
| GET | `/api/v1/sync/pull?cursor=0&limit=500` | Ordered tenant changes and next cursor |
| POST | `/api/v1/documents/uploads` | Initiate local upload; requires `Idempotency-Key` |
| PUT | `/api/v1/documents/uploads/:id/content?token=...` | Upload exact raw bytes |
| POST | `/api/v1/documents/uploads/:id/complete` | Verify and complete upload |
| GET | `/api/v1/documents/:id` | Tenant-authenticated download |
| POST/GET | `/api/v1/satellite/analyses[/:id]` | Satellite operation |
| GET | `/api/v1/satellite/analyses/:id/images/:plotId` | Image stored by a Copernicus Process run (tenant-authenticated) |
| GET/PUT | `/api/v1/admin/organizations/:id/copernicus-process` | Organization administrators: read/update the Copernicus Process configuration |
| POST | `/api/v1/admin/organizations/:id/copernicus-process/test` | Check the stored credentials with a 64 px Process API request (5 per minute) |
| POST/GET | `/api/v1/evidence-packs[/:id]` | Generate/query evidence pack |
| POST/GET | `/api/v1/dds/drafts[/:id]` | Create/query DDS draft |
| POST | `/api/v1/dds/drafts/:id/validate` | Validate draft |
| POST | `/api/v1/dds/drafts/:id/submit` | Submit only after review approval |
| GET/POST/PATCH | `/api/v1/admin/organizations...` | Organizations, users, config, geofences |
| GET/POST/PATCH | `/api/v1/admin/users[/:userId]?organizationId=...` | Legacy compatibility aliases for organization-scoped user management |
| GET | `/api/v1/admin/organizations/:id/reviews` | Geofence and DDS review queue |
| POST | `/api/v1/admin/reviews/:type/:id/decision` | Approve/reject review |
| GET | `/api/v1/admin/organizations/:id/dds-reconciliation` | Uncertain/in-progress DDS submissions requiring an explicit decision |
| POST | `/api/v1/admin/dds-actions/:id/reconcile` | Confirm an external reference or reset a submission as not submitted |
| GET | `/api/v1/admin/organizations/:id/audit-logs` | Tenant audit history |

Operation-creation and DDS action requests require `Idempotency-Key`. A plot outside
all active organization geofences creates a review and returns HTTP 409
`GEOFENCE_REVIEW_REQUIRED`; the exact same idempotent operation remains retryable and
is accepted after approval. The error details are
`{"violations":[{"violationId":"...","operationId":"...","entityId":"..."}]}`;
every entry is derived from the current tenant's batch and identifies the exact plot
outbox operation that caused the violation. Plot objects returned through sync pull or conflict
payloads contain the authoritative `geofenceStatus` (`pending`, `inside`,
`review_required`, or `approved`) and `localGeofenceResult` (`pending`, `inside`, or
`outside`). An approved out-of-fence exception is represented as
`geofenceStatus: "approved"` and `localGeofenceResult: "outside"`.
Any non-approved geofence violation blocks DDS creation, validation, and submission.
Protected mobile calls may send `X-Organization-Id`. If present, it must exactly
match the organization claim in the access token; a mismatch returns HTTP 403
`ORGANIZATION_MISMATCH`. Login and refresh return `organizations: [{id,name}]`
plus `selectedOrganizationId`; organization users receive their one active
organization, while system administrators receive an empty list and `null`.

All `/api/v1/admin/*` endpoints require `Authorization: Bearer <accessToken>`.
The organization-scoped user routes are available both as
`/api/v1/admin/organizations/:organizationId/users...` and legacy aliases
`/api/v1/admin/users...?organizationId=<uuid>`. For non-system users, the
organization id is derived from the token and cross-organization access is denied.

Satellite and EU API keys are encrypted with AES-256-GCM; their GET representation
contains only `has...` flags. Arbitrary `extra` settings reject secret-like keys.

The EU EUDR V3 adapter defaults to `mock`. Live mode requires HTTPS, denies common
loopback/private targets, disables redirects, enforces a timeout, and XML-escapes
all values. Credentials are AES-256-GCM encrypted at rest. Admin GET responses expose
only `hasUsername`, `hasPassword`, and `hasClientId`, never secret values.

### Durable DDS actions

Migration `003_dds_idempotency_and_plot_geofence.sql` stores every DDS validation
and submission action in `dds_actions`, protected by tenant RLS. An idempotency key
is unique per organization and is permanently bound to one DDS operation and one
action. Repeating the same request returns the stored HTTP result; reusing its key
for another operation or action returns `IDEMPOTENCY_KEY_REUSED`.

Submission is committed as `processing` before the SOAP call begins. A transport
failure, timeout, HTTP 5xx response, unreadable response, or successful response
without a reference is not retried automatically: the action becomes `uncertain`,
the DDS phase becomes `reconciliation_required`, and the API returns
`DDS_RECONCILIATION_REQUIRED`. An administrator must then make one of these audited
decisions:

- `{"decision":"confirm_submitted","externalReference":"...","note":"..."}` confirms
  a reference verified outside SCTracker.
- `{"decision":"reset_not_submitted","note":"..."}` returns the draft to `validated`;
  a later submit must use a new idempotency key.

The Admin SPA exposes only permitted tabs and actions. System and organization
administrators can manage and reconcile; reviewers start on read-only geofences
and can process reviews; auditors start on read-only geofences and can read audit
history. Field agents have no Admin SPA access.

## Copernicus Process API integration

The satellite analysis can use the **Process** service (`POST /process/v1`) of the Copernicus Data
Space Ecosystem / Sentinel Hub (specification: `openapi.v1.yaml`, tag group "Process API"). The
Catalog (`POST /catalog/v1/search`) is additionally used to check acquisition availability for the
optional swipe comparison. Async, Batch, Statistics, BYOC, Zarr and TPDI are not integrated.

- Configure it per organization in the admin area, tab **Copernicus Process**. The settings are
  stored in `organization_copernicus_process_config` (migration `007_copernicus_process.sql`), so the
  existing **API / EU** configuration is unchanged. Client ID and secret (OAuth2 client credentials)
  are encrypted with AES-256-GCM and never returned.
- It only takes effect when `satelliteEnabled` of the existing configuration is on **and** the
  integration is enabled with credentials. Otherwise the previous mock screening is used.
- A satellite request (`subjectId` = plot id, or `plotIds`) requests one image per plot: the plot
  polygon is sent as `bounds.geometry` together with its bbox, a time range of `lookbackDays` up to
  now, and the dataset options (Sentinel-2 L2A/L1C: cloud cover, mosaicking order, harmonization;
  Sentinel-1 GRD: acquisition mode, polarization, orbit direction, resolution, speckle filter,
  back-scatter coefficient, orthorectification/DEM). Evalscript presets: true colour, NDVI, SAR VV or a
  custom evalscript. Images are stored in the object store and returned in `results[]` of the operation.
- At most `maxPlotsPerRun` plots (default 5, maximum 20) are analysed per request, one after another;
  keep the value small because the request runs inside the HTTP call. Plots that fail are listed in
  `failures[]`; the operation fails if no plot succeeds.
- Only `https` hosts below `dataspace.copernicus.eu` or `sentinel-hub.com` are accepted for the Process
  API and token URLs; redirects are rejected.

### Historical swipe comparison

Apply migration `016_satellite_comparison.sql` before deploying. It adds
`organization_api_config.satellite_comparison_enabled NOT NULL DEFAULT false` under the existing tenant RLS.
Organization/system administrators activate it under **API / EU**, via
`PUT /api/v1/admin/organizations/:organizationId/config` with `satelliteComparisonEnabled: true`.
GET returns the flag; omitting it on PUT preserves the stored value for older clients. Changes are audited.
Both comparison periods require activation before accessing even a cached image (`403` when disabled).
Normal backgrounds and satellite analysis operations retain their existing behavior.

The baseline request never widens the UTC day 2020-12-31. The Catalog availability check uses the same
Sentinel-2 L2A collection, WGS84 bbox, cloud threshold and time range as the Process request.
Catalog/network errors surface as errors, not as absent imagery. Image generation uses Web Mercator
for matching Google overlays; the response bbox is still WGS84. The browser hides the comparison
if any requested area lacks an acquisition and does not substitute newer historical imagery.
The current image uses the most recent data within the displayed search window (minimum 60 days),
not necessarily today's imagery. Google imagery has no guaranteed capture date. Missing coverage
within an available acquisition is grey, not transparent to the current Google imagery beneath it.

## Validation

```powershell
npm test
npm run typecheck
npm run build
```

Database integration can be smoke-tested after migration with `GET /health`.
