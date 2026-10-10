# Meridian

A medium-sized clinic platform built around one complete visit workflow. Four domain modules, one web app, and one planned worker.

This is a **demonstration build**. It is not certified, not integrated with any national health system, and not a deployment candidate — no real patient information should ever enter it.

The complete visit thread is implemented end to end: a patient books, the front desk checks them in, the clinician conducts the encounter and writes a note, signs it (and may amend it), one charge is recorded, and the patient reads the summary their clinician published. An administrator can read the hash-chained access log. Four of the nine planned screens remain: the patient appointment list, the clinician chart view, prescribing, and the staff waiting-room board.

## Start the application

Requires Node.js 22 or newer.

```powershell
npm.cmd ci
npm.cmd run dev -- --port 4000
```

Open **http://127.0.0.1:4000/** for the marketing homepage, `/sign-in` or `/sign-up` for account flows, and `/design` for the synthetic design library. Public pages and the design preview need no database; everything behind a session does. When configuration is missing, forms provide validation and explain that account services are unavailable, without creating a pretend session.

## Sixty-second demo walkthrough

Complete the infrastructure steps below first, then sign in as each role with your configured `SEED_PASSWORD`. Non-patient roles enrol an authenticator on first sign-in.

1. **Book a visit.** Sign in as `patient@example.test` and open `/patient/book`. Choose a clinician, give a reason, pick a time, and confirm. Nothing is written until you confirm, and the slot is claimed transactionally.
2. **Run the clinic.** Sign in as `clinician@example.test` and open `/clinical/today`. Move between patients with `j` and `k` — selecting one performs an authorized, audited chart read. Check a patient in, move them through to ready, then start the visit.
3. **Conduct the encounter.** Write the note; it autosaves and shows saved, unsaved or failed state — never optimistically. Sign it, which freezes that version, then amend it with a reason and watch the signed text survive underneath. Complete the visit to record one charge and publish the summary.
4. **Read the summary.** Back as the patient, open the visit from `/patient/book`. Before completion it shows the unpublished state rather than any draft text.
5. **Inspect the trail.** Sign in as `admin@example.test` and open `/admin/audit`. Every read, write and denial is there, newest first, with chain verification across the whole log. Note that the administrator has no route to any chart.

To see authorization refuse something, sign in as `clinician2@example.test` and open an encounter belonging to the other clinician's patient: it is denied, and the denial is recorded.

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
src/app/                  Next.js routes, Server Actions and shared layouts
src/components/ui/        Reusable styled Radix primitives
src/components/app/       Authenticated workspace shell
src/components/design/    Interactive design-review specimens
src/components/public/    Brand and lightweight product illustration
src/components/auth/      Credential, MFA and recovery-code interfaces
src/modules/identity/     Auth, MFA, sessions, care access, audit, audit viewer
src/modules/scheduling/   Patients, availability, booking and appointment state
src/modules/clinical/     Encounters, versioned notes, chart reads, drafting assistance
src/modules/billing/      Charges, recorded once per encounter
src/platform/             PostgreSQL, Redis, outbox, safe logging
src/lib/                  Formatting, clinic-day arithmetic, action state
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

The seed anchors every timestamp on a clinic day. Run from the command line it uses **today** in `CLINIC_TIMEZONE`, so a fresh demo has a populated clinic; set `SEED_CLINIC_DAY=YYYY-MM-DD` to pin it. Called directly it defaults to 21 September 2026, which keeps the test suites deterministic. It creates 40 synthetic patients, 84 slots (36 on the clinic day plus 48 unbooked across the following four days so booking always has real future availability), 12 appointments, allergies/problems/observations, real medication names labelled `synthetic-fixture`, and one draft encounter. It does not issue prescriptions or claim live interaction checking. Re-running leaves an existing seed clinic untouched.

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

## Clinical workflow

- `/patient/book` serves availability from the server, claims the slot inside a transaction, and defers to a partial unique index as the real guarantee. A losing race returns the patient's provider and reason intact and re-fetches a current list of times, so only the time has to be chosen again.
- `/clinical/today` lists only the signed-in clinician's own sessions. Selecting a patient is an explicit, authorized, audited chart read rather than a prefetch of every row, so the log reflects what was actually opened. `j`/`k` move between patients.
- `/clinical/encounters/[uuid]` autosaves against a stored revision and never reports a save the server has not confirmed. Signing freezes that version; an amendment creates a linked version with a mandatory reason while a database trigger keeps the signed text intact. Completing the visit verifies the note is signed, records one charge in integer minor units, closes the appointment and enqueues identifier-only outbox events in a single transaction; resubmitting returns the committed result instead of charging again.
- `/patient/visits/[uuid]` shows only a summary the clinician wrote, reviewed and published. Before that it shows its unpublished state, never draft note text.
- `/admin/audit` reads through the separate auditor credential, which has no grant on `users` or `patients` — so the viewer shows identifiers and cannot resolve a name even for an authorized administrator. Patient names are never filter values. Opening the log is audited, and administration still grants no chart access.
- Each audit event stores a SHA-256 hash over its own fields and its predecessor's hash, assigned by a `SECURITY DEFINER` trigger because the runtime role cannot read the log. `verify_audit_chain()` recomputes the chain on every page load. Append-only grants make the log tamper-resistant; the chain makes it tamper-evident, including against the table owner.
- Setting `ANTHROPIC_API_KEY` enables optional note-drafting assistance. Only clinical facts are sent — never a name, MRN, date of birth or internal identifier. The clinician must edit and sign the result; nothing is saved or signed for them, and the feature hides itself when the key is absent.

Still to build from the original nine screens: the patient appointment list with reschedule, the clinician chart view, prescribing, and the staff waiting-room board with its authenticated WebSocket. Prescribing is deliberately blocked at the database level while drug data is synthetic: `issued_requires_safety` refuses to issue any prescription whose safety source is `synthetic-fixture`.

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

Browser tests exercise public navigation, account validation and error focus, password visibility, protected routes, service-unavailable feedback, both design themes/registers, queue keyboard movement, dialogs and focus restoration, explicit confirmation, command search, reduced motion, accessibility and responsive layouts. Public pages are checked at 360/390/768/1440px. Screenshots are saved to `.artifacts/`.

Unit tests cover the authentication action boundary, clinic-day arithmetic across daylight-saving boundaries, the appointment transition table, note and encounter state rules, and outbox idempotency keys. The integration suite needs Docker and verifies the parts that only a real database can prove: registration and clinic isolation, MFA and single-use recovery codes, concurrent slot claiming, stale-revision rejection, signed-text preservation through amendment, one charge per encounter however many times completion is submitted, cross-patient denial, and hash-chain detection of a row altered by the table owner. Automated accessibility checks do not replace a screen-reader or clinical usability review.

The lockfile includes narrowly scoped PostCSS and development esbuild overrides to avoid inherited advisories while preserving Next.js 15 and Drizzle. Revalidate these overrides when upgrading their parent dependencies. No real patient information should enter this review build.
