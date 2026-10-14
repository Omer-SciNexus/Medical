# Meridian

A clinic platform built around one complete visit workflow: book, check in, conduct the encounter, sign the note, record the charge, publish the patient's summary.

**This is a demonstration build.** It is not certified, not connected to any national health system, and not a deployment candidate. Use synthetic data only.

## What works

The visit thread runs end to end across five screens: patient booking, the clinician's day, the encounter and note, the patient's visit summary, and the administrator's access log. Behind them are real scheduling, clinical and billing services, MFA with care-relationship authorization, and a hash-chained audit log.

Not built yet: the patient appointment list, the clinician chart view, prescribing, and the staff waiting-room board.

## Run it

Needs Node.js 22 or newer and Docker with Linux-container support.

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
# Fill MFA_ENCRYPTION_KEY, AUTH_PEPPER and SEED_PASSWORD
npm run infra:up      # PostgreSQL, Redis and MinIO on loopback ports
npm run db:migrate
npm run db:seed
npm.cmd run dev -- --port 4000
```

Open **http://127.0.0.1:4000/**. Public pages and `/design` work without a database; everything behind a session needs one.

Seeded accounts all use your `SEED_PASSWORD`: `patient@`, `clinician@`, `clinician2@`, `staff@` and `admin@example.test`. Every role except patient enrols an authenticator on first sign-in — add the setup key to a TOTP app and save the eight recovery codes.

If this Windows host stalls fetching fonts or packages, prefer IPv4:

```powershell
$env:NODE_OPTIONS = '--dns-result-order=ipv4first --no-network-family-autoselection'
```

## Try the workflow

1. As `patient@example.test`, book a visit at `/patient/book`.
2. As `clinician@example.test`, open `/clinical/today`. Move with `j`/`k`, check the patient in, then start the visit.
3. Write the note, sign it, amend it with a reason, then complete the visit.
4. Back as the patient, read the published summary.
5. As `admin@example.test`, open `/admin/audit` to see every read, write and denial.

To watch authorization refuse something, sign in as `clinician2@example.test` and open the other clinician's encounter. It is denied, and the denial is recorded.

## Verify

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration   # needs Docker; real PostgreSQL and Redis
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev       # the gate CI blocks on
```

## Structure

```
src/app/              Routes, Server Actions, layouts
src/components/       UI primitives, workspace shell, design specimens
src/modules/identity/ Auth, MFA, sessions, care access, audit
src/modules/scheduling/ Patients, availability, booking, appointment state
src/modules/clinical/ Encounters, versioned notes, chart reads
src/modules/billing/  Charges, one per encounter
src/platform/         PostgreSQL, Redis, outbox, safe logging
src/lib/              Formatting, clinic-day arithmetic, action state
drizzle/              Forward-only migrations
scripts/              Migration runner and synthetic seed
tests/                Unit, Testcontainers and Playwright tests
```

Cross-domain imports go through each module's public `index.ts`, enforced by ESLint.

Runtime services connect as `meridian_app`, which cannot DELETE or TRUNCATE and can only INSERT into the audit log. A separate `meridian_auditor` has SELECT-only audit access. Use the owner connection for migrations and the seed only, and never run `drizzle-kit push` in a shared environment.

## More

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) — milestones, all nine screens, service contracts, acceptance criteria.
- [Verification status](docs/STATUS.md) — what is implemented, what has been checked, and the known limitations.
