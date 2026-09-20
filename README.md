# Meridian

A medium-sized clinic platform built around one complete visit workflow. Four domain modules, one web app, one worker planned after the design review. The original brief's **mandatory `/design` review checkpoint is active**: this delivery contains the data/identity foundation and an interactive design library. The nine application screens and workflow services follow approval; the gallery is not a functioning clinic system.

## Start the design preview

Requires Node.js 22 or newer.

```powershell
npm ci
npm run dev
```

Open **http://127.0.0.1:3000/design**. `/` redirects there. No environment variables, database or sign-in are needed for the synthetic design library. Google Fonts must be reachable during the first build; `next/font` downloads and self-hosts IBM Plex Sans/Mono so browsers do not request Google Fonts.

If this Windows host stalls on font downloads, launch the build with IPv4 preference:

```powershell
$env:NODE_OPTIONS = '--dns-result-order=ipv4first --no-network-family-autoselection'
npm run build
npm start
```

## Detailed plan and structure

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): milestones, all nine screens, service contracts, acceptance criteria, remaining product decisions and release checks.
- [Verification status](docs/STATUS.md): completed checks and environment limitations.

```
src/app/                  Next.js routes and shared layouts
src/components/ui/        Reusable styled Radix primitives
src/components/design/    Interactive design-review specimens
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

Development accounts are `patient@example.test`, `clinician@example.test`, `clinician2@example.test`, `staff@example.test` and `admin@example.test`, using your configured `SEED_PASSWORD`. Staff roles must enroll MFA on first authentication. Authentication service functions exist; sign-in/reset/enrollment screens are part of the next application phase.

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

Browser tests exercise both themes/registers, queue keyboard movement, dialogs and focus restoration, validation, explicit confirmation, command search, reduced motion, accessibility and 390/768/1440px layouts. Screenshots are saved to `.artifacts/`. Automated accessibility checks do not replace a screen-reader/clinical usability review.

The lockfile includes narrowly scoped PostCSS and development esbuild overrides to avoid inherited advisories while preserving Next.js 15 and Drizzle. Revalidate these overrides when upgrading their parent dependencies. No real patient information should enter this review build.
