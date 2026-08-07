# Authentication and session security

Authentication establishes an actor; authorization decides whether that actor
may perform a specific operation in a tenant and branch.

## Business login

Business users submit:

- Business slug or code
- Username or email
- Password
- Optional branch selection

The server normalizes the business and username, applies rate limits, loads the
account inside that tenant, verifies password hashing, then checks tenant, user,
and branch states. Error messages avoid revealing which field was valid.

Passwords use Argon2id through a maintained library. Hash parameters are
versioned and upgraded opportunistically after successful authentication.

## Access and refresh tokens

Access tokens are short lived and contain only stable identifiers and session
claims:

- Subject user ID
- Session ID
- Tenant ID, or an explicit platform principal marker
- Active branch ID when applicable
- Issued, expiry, issuer, and audience claims

Permission checks use current server-side grants for sensitive commands; a
long-lived permission list must not be trusted from an old token.

Refresh sessions are persisted as non-reversible token hashes with expiry,
device metadata, rotation lineage, and revocation timestamps. Each refresh:

1. Validates the current token and session state.
2. Revokes the presented token.
3. Creates one replacement in the same transaction.
4. Returns a new access/refresh pair.

Reuse of a rotated token revokes the token family and creates a security audit
event. Logout revokes the current session; account disable, password reset, or
tenant suspension can revoke broader scopes.

The browser uses a same-origin BFF. Access and refresh tokens are held in
`HttpOnly`, `SameSite=Lax` cookies and are never written to browser storage.
Mutating BFF routes reject cross-origin browser requests; the API remains the
authoritative authorization boundary.

Global business roles can list only active branches in their authenticated
tenant and switch the current branch through refresh-session rotation. A switch
rotates the token family, invalidates the previous access/refresh pair, preserves
the remember-me policy, and clears branch-scoped browser caches. Branch-bound
employees can enumerate only their assigned branch and cannot switch context.

## Fast PIN login

PIN login is not a weaker universal password. It requires:

- A selected tenant and branch
- A registered trusted device with a revocable, branch-scoped credential
- An individual employee identity
- Persistent credential and network rate limits
- Short idle lock and visible user switching
- Audit events for success, failure, lockout, and device changes

PINs are hashed and never logged. A user without branch access cannot use that
branch's trusted device to create a session. A trusted-device credential is
generated only after a successful password login, returned once to the same-origin
BFF, stored in an `HttpOnly`, `SameSite=Strict` cookie, and persisted by the API
only as a SHA-256 hash. Each record carries tenant, branch, expiry, revocation,
last-use, and enrollment metadata. Logging out of a staff session does not remove
device trust; a subsequent password login rotates the credential for the current
tenant and branch.

`DIXORA_PIN_LOGIN_ENABLED` is the server-side emergency switch and defaults to
`false` outside the Compose development profile. `DIXORA_TRUSTED_DEVICE_DAYS`
controls the credential lifetime. Disabling the public UI flag does not replace
the backend switch.

## Password reset and two-factor readiness

The schema may reserve reset and second-factor concepts, but a production
workflow requires:

- Single-use, short-lived reset tokens stored as hashes
- Non-enumerating requests
- Verified delivery channel and rate limits
- Session revocation after reset
- Recovery and audit behavior
- TOTP/WebAuthn enrollment, challenge, backup, and removal controls if 2FA is
  enabled

Placeholder endpoints must not be presented as working security features.

## Super Admin and support access

Platform administrators use separate accounts and routes. Support mode requires
an explicit target tenant, reason, bounded lifetime, prominent UI indication,
step-up authentication, and append-only audit events. It must not mint a normal
business owner session or silently bypass tenant filters.

## Rate limiting

Password and PIN failures are persisted as sanitized audit events.
The API enforces a configurable rolling limit using a credential fingerprint
plus client address, so an application restart does not silently remove
brute-force protection. QR ordering separately limits unresolved requests per
table and preserves idempotent retries.

Internet-facing deployments should add a distributed edge limiter for network,
refresh, reset, and broad abuse controls. Availability policy must be explicit:
an edge/Redis outage must not silently remove the API's persistent protection.

## Audit and privacy

Record authentication outcome, actor/session when known, tenant, reason code,
request ID, IP-ready value, and user-agent-ready value. Never log passwords,
PINs, raw tokens, reset links, API keys, or full authorization headers.

## Required tests

- Password success/failure and inactive user/tenant/branch
- Uniform public error behavior
- Refresh rotation and replay-family revocation
- Logout and administrative revocation
- Cross-tenant business identifier manipulation
- PIN device and branch restrictions
- Rate limit boundaries
- Authorization after role changes
- Production configuration rejects weak secrets
