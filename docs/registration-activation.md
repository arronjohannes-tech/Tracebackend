# Registration approval and mobile activation

The production Tracehub users view includes registration management for
`system_admin` accounts only. Registration API calls are global and do not use
the currently selected organization as a filter.

## Administration workflow

- Search by the server-supported search fields and filter by pending, approved,
  active, or disabled. Results are paginated in groups of 25.
- Open a row to inspect contact information, assigned roles, organization, mail
  delivery status, and lifecycle dates.
- Approving a pending registration requires choosing an organization and one or
  more managed roles. The backend sends the initial activation link. The user
  has no account access until setting a password in the native app.
- Approving a disabled registration that still references an existing account
  re-enables that account and retains its current organization, roles, and
  password; it does not send a new initial activation link. The details dialog
  shows the existing organization and roles read-only. The required approval
  request carries those current values; assignment changes are not offered as
  part of reactivation. The backend must reject deleted accounts rather than
  recreating or reactivating them.
- Pending and approved registrations can be deactivated; this revokes their
  activation links. An approved registration can also have its activation
  email resent. An active account can be deactivated. The UI confirms each
  operation and reports API and refresh errors without treating failures as
  success.

## HTTPS landing page and token handling

Configure the production HTTPS origin as
`https://tracehub-ten.vercel.app`. The email activation URL should use
`https://tracehub-ten.vercel.app/mobile-activate.html#token=<url-encoded-token>`.
The landing page reads the fragment once, removes it from the visible browser
URL immediately, and presents an explicit link to
`tracehub://activate?token=<url-encoded-token>`. It does not automatically
redirect, persist the token, or send it as a referrer. The page accepts only
decoded tokens between 32 and 256 characters, matching the native/API limit.
Users without the app
are told to obtain it through their organization's distribution channel; the
page intentionally does not invent an app-store URL.

The native app is responsible for validating the activation token and showing
the password setup screen. The landing page does not activate accounts itself.

## Native HTTPS association setup

Do not publish placeholder association documents. Before enabling verified
HTTPS app links, obtain the production iOS Team ID and bundle identifier, plus
the Android application ID and signing-certificate SHA-256 fingerprint from
the signed native builds:

- Host the correctly signed iOS `apple-app-site-association` document at
  `https://tracehub-ten.vercel.app/.well-known/apple-app-site-association`
  (without a file extension or redirect), listing the production app ID and
  activation path.
- Host Android `assetlinks.json` at
  `https://tracehub-ten.vercel.app/.well-known/assetlinks.json`, with the
  production package name and the exact Play/App Signing SHA-256 fingerprint.
- Configure the corresponding iOS Associated Domains entitlement and Android
  verified App Links intent filter, then verify both files over HTTPS against
  the signed release builds.

The custom `tracehub://activate` URL is the explicit landing-page fallback.
Keep association metadata synchronized with the released app identifiers and
signing credentials.
