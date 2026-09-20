# Delivery status — 20 September 2026

## Current checkpoint

The brief requires: “Stop and show me this before building screens.” Meridian is paused at that design-review checkpoint. `/design` is implemented and verified as a synthetic, interactive component library. This is not the completed clinical platform or a production-ready deployment.

## Implemented

- Medium-sized modular structure with identity, scheduling, clinical and billing domains; public service boundaries enforced with ESLint.
- Next.js 15.5.25 App Router, TypeScript strict, Tailwind v4, Radix, Plex Sans/Mono via `next/font`.
- Docker Compose definition for PostgreSQL, Redis and MinIO; separate owner, runtime and audit-reader database roles.
- Sixteen Drizzle tables, a generated initial migration, and a custom forward migration for cross-domain foreign keys, slot exclusion, immutable provenance/signed notes, append-only audit and grants.
- Deterministic development seed for 40 synthetic patients, 36 slots, 12 appointments, coherent sample records and one draft encounter.
- Identity service code: scrypt passwords, encrypted TOTP enrollment, MFA challenges/replay checks, single-use recovery codes, rate limits, Redis sessions and revocation, current-user checks, care relationships, purpose authorization, expiring read-only break-glass and audit wrapper.
- Light/dark design library: both density registers, interactive queue, patient booking specimen, controls, inline validation, amendment confirmation, empty/loading/error states, command palette, keyboard navigation, responsive layouts and reduced motion.
- Unit, Testcontainers and browser test suites; CI workflow definition; setup and delivery documentation.

## Verification performed

| Check | Result |
|---|---|
| TypeScript | Passed |
| ESLint including domain boundaries | Passed |
| Unit tests | 32 passed |
| Production build | Passed; `/design` statically prerendered |
| Playwright | 9 passed |
| Automated accessibility | No axe violations under WCAG 2 A/AA, 2.1 AA, 2.2 AA tags in both themes and both registers |
| Responsive checks | No page overflow at 390, 768, 1440px |
| Visual review | Inspected desktop light/dark and mobile patient screenshots |
| Keyboard behavior | Queue j/k, command palette, dialog focus containment/restoration, explicit confirmation passed |
| Reduced motion | Skeleton animations disabled when requested |
| Dependency audit | 0 reported vulnerabilities after scoped PostCSS/esbuild overrides |
| Migration generation | Passed; subsequent generation reported no schema changes |
| PostgreSQL/Redis integration | Could not run: no working Docker/container runtime; 33 tests did not execute |

The custom SQL, grant behavior, seed execution, real authentication/session flows and Compose services are **not live-verified** on this machine. A migration-generation success does not verify migration execution. The CI workflow has been written, not run remotely.

`/design` reports 187 kB of first-load JavaScript (84.3 kB route plus shared code). The gallery intentionally imports every interactive primitive. Clinical routes should use smaller client islands. This build-size observation is not a Core Web Vitals or concurrency benchmark. Field performance, backend load, manual assistive-technology testing, real clinician usability, backup restore and production security review remain required.

## Review artifacts

Generated screenshots (ignored by Git) are in `.artifacts/`:

- `design-clinical-1440.png`
- `design-clinical-dark-1440.png`
- `design-patient-1440.png`
- `design-clinical-390.png`, `design-patient-390.png`
- `design-clinical-768.png`, `design-patient-768.png`

## After design approval

Implement authentication UI and credential lifecycle, then the nine screens in brief order with real scheduling/clinical/billing services. Complete transactional booking/rescheduling, chart reads, encounter autosave/sign/amend, medication safety integration and prescription issue, idempotent charge generation, published visit summaries, reminders, BullMQ outbox dispatch, authenticated WebSockets and the audit viewer. Add service tests as each service is implemented and extend E2E coverage to the complete visit thread.

No live drug-interaction provider, e-prescribing provider, reminder transport, payment processor or deployment is configured. Those boundaries are listed explicitly in the implementation plan. No patient booking, prescription, charge or notification is performed by a gallery control.
