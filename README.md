# Meridian

A medium-sized clinic platform built around one complete visit workflow. Four domain modules, one web app, and one planned worker. This delivery includes a public marketing homepage, clinic-owner registration and sign-in interfaces, an identity/data foundation, and an interactive design library. The complete clinical workflow and nine clinical screens remain in development; the gallery is not a functioning clinic system.

## Start the application

Requires Node.js 22 or newer.

```powershell
npm.cmd ci
npm.cmd run dev -- --port 4000
```

Open **http://127.0.0.1:4000/** for the marketing homepage, `/sign-in` or `/sign-up` for account flows, and `/design` for the synthetic design library. `/dashboard` requires a valid session. Public pages and the design preview need no database; authentication does. When configuration is missing, forms provide validation and explain that account services are unavailable, without creating a pretend session.

Google Fonts must be reachable during the first build; `next/font` downloads and self-hosts IBM Plex Sans/Mono so browsers do not request Google Fonts.

If this Windows host stalls on font downloads, launch the build with IPv4 preference:

```powershell
$env:NODE_OPTIONS = '--dns-result-order=ipv4first --no-network-family-autoselection'
npm.cmd run build
npm.cmd run start -- --port 4000
# In a second terminal, after the same build:
npm.cmd run start -- --port 4001
```

## Detailed plan and structure

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): milestones, all nine screens, service contracts, acceptance criteria, remaining product decisions and release checks.
- [Verification status](docs/STATUS.md): completed checks and environment limitations.

```
src/app/                  Next.js routes and shared layouts
src/components/ui/        Reusable styled Radix primitives
src/components/design/    Interactive design-review specimens
src/components/public/    Brand and lightweight product illustration
src/components/auth/      Credential, MFA and recovery-code interfaces
src/modules/identity/     Auth, MFA, sessions, care access, audit
src/modules/scheduling/   Patients, availability and appointment schemas
src/modules/clinical/     Encounters, notes, observations and Rx schemas
src/modules/billing/      Charge schema
src/platform/             PostgreSQL, Redis, outbox, safe logging
src/lib/                  Formatting and presentation helpers
drizzle/                  Forward-only migrations
scripts/                  Migration runner and synthetic seed
tests/                    Unit, Testcontainers and Playwright tests
```

Cross-domain imports go through public `index.ts` service exports, enforced by ESLint. The migration/seed tools and tests deliberately access schemas. The scheduling-to-identity authorization handshake returns only a scope-membership boolean, never a patient record; it must not be exposed as a public action. The remaining repositories/services/jobs are added as working features after design review, rather than empty module scaffolds.

## Local infrastructure

Requires Docker with Linux-container support. Compose credentials are development-only and ports bind to loopback. Do not use these defaults for a real clinic.

```powershell
Copy-Item .env.example .env.local
# Fill MFA_ENCRYPTION_KEY, AUTH_PEPPER, and SEED_PASSWORD in .env.local.
npm run infra:up
npm run db:migrate
npm run db:seed
```

Use the owner connection only for migrations/seed. Runtime services use `meridian_app`, which has no DELETE/TRUNCATE privileges and has INSERT-only access to the audit log. A separate `meridian_auditor` connection has SELECT-only audit access, reserved for the authorized audit viewer. Never use `drizzle-kit push` in shared environments. Commit generated SQL, add forward-only custom SQL for cross-domain constraints and review both before migrating.

The seed uses 21 September 2026 as its fixed sample clinic day. It creates 40 synthetic patients, 36 slots, 12 appointments, allergies/problems/observations, real medication names labelled `synthetic-fixture`, and one draft encounter. It does not issue prescriptions or claim live interaction checking. Re-running leaves an existing seed clinic untouched.

Development accounts are `patient@example.test`, `clinician@example.test`, `clinician2@example.test`, `staff@example.test` and `admin@example.test`, using your configured `SEED_PASSWORD`. Non-patient roles must enroll MFA on first authentication. Use `/sign-in` to enter credentials, add the setup key to a time-based authenticator app, verify the six-digit code, and save the eight single-use recovery codes.

## Account flows

- `/sign-up` creates a **new clinic and its administrator** in one audited transaction. It never accepts a client-selected role or existing clinic ID. Registration does not attach users to existing patients or clinics. Owners must enroll MFA before receiving a session.
- `/sign-in` accepts existing patient, clinician, staff and administrator accounts. MFA-enabled accounts complete verification; a saved recovery code can replace the authenticator code. Recovery-based sessions do not satisfy the fresh-TOTP prescribing requirement.
- `/dashboard` validates the current user and server-side session on each request. It currently provides an account welcome screen and a link to the synthetic workspace preview. Signing out revokes the Redis session before removing its cookie.
- Challenge and session tokens stay in HttpOnly, SameSite Strict cookies. No authentication tokens are placed in URLs or browser storage. Production origins require HTTPS and Secure cookies. Known loopback origins support local HTTP development.
- `APP_ORIGIN` is an exact origin. `APP_ADDITIONAL_ORIGINS` is a comma-separated explicit allowlist for other instances. The example supports ports 4000 and 4001; replace it with deployment origins before publishing. Next.js also applies its normal Server Action origin checks.
- The web adapter uses a conservative shared request-limit bucket and per-account limits. It deliberately does not trust arbitrary forwarding headers. Configure a trusted reverse-proxy address adapter and edge limits before public deployment.

The authentication code is implemented, but successful PostgreSQL/Redis-backed flows have **not been verified on this host**: Docker is not installed and `.env.local` is not configured. Install/start Docker with Linux containers, complete the local infrastructure steps above, restart the web servers, and run the integration suite before relying on these flows.

Email verification, email password reset, invitations, account recovery administration and credential lifecycle UI remain future work. No email ownership or production-readiness claim is made by registration. Keep this development build restricted to synthetic accounts until those controls and the remaining release checks are complete.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration # requires Docker; real PostgreSQL + Redis
npm run build
npx playwright install chromium
npm run test:e2e         # starts the production server if needed
npm audit
```

Browser tests exercise public navigation, account validation and error focus, password visibility, protected routes, service-unavailable feedback, both design themes/registers, queue keyboard movement, dialogs and focus restoration, explicit confirmation, command search, reduced motion, accessibility and responsive layouts. Public pages are checked at 360/390/768/1440px. Screenshots are saved to `.artifacts/`. Unit tests verify the authentication action boundary; the integration suite verifies real registration, clinic isolation, MFA and single-use recovery codes when Docker is available. Automated accessibility checks do not replace a screen-reader/clinical usability review.

The lockfile includes narrowly scoped PostCSS and development esbuild overrides to avoid inherited advisories while preserving Next.js 15 and Drizzle. Revalidate these overrides when upgrading their parent dependencies. No real patient information should enter this review build.
