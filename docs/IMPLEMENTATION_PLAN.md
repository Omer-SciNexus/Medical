# Meridian implementation plan

## Product boundary

A medium-sized clinic application with four domain modules and nine screens. Finish one thread: book an appointment, check in, conduct the encounter, sign a note, issue a prescription, generate a charge, publish the patient summary. One Next.js web application, one BullMQ worker, and a small authenticated WebSocket service. No microservices or additional product modules.

English is the initial interface language; Europe/Istanbul is the development clinic timezone. Currency, jurisdiction, drug data provider, prescription transmission provider, notification provider, hosting/data residency, and production retention policy remain deployment decisions. Store timestamps in UTC and render in the clinic's IANA timezone. Include clinic ownership now so records cannot bleed across practices. Do not imply regulatory certification.

## Repository structure

```
src/app/                    App Router pages, layouts, Server Actions
src/components/ui/          Accessible, styled Radix primitives
src/components/design/      Review-only design gallery with synthetic examples
src/modules/identity/       Users, clinics, sessions, MFA, access, audit
src/modules/scheduling/     Patients, availability, appointments, check-in
src/modules/clinical/       Problems, allergies, observations, encounters, notes, Rx
src/modules/billing/        Charges and encounter-completion billing rules
src/platform/               Database, Redis, outbox, safe operational logging
src/lib/                    Pure formatting and shared non-domain utilities
scripts/                    Migrations and deterministic development seed
drizzle/                    Committed forward-only SQL and migration metadata
tests/                      Unit, integration, browser verification
docs/                       Plan, architecture decisions, verification status
```

Each domain owns its schema, validators, repository, service functions, and jobs as they are implemented. Avoid empty placeholder services. Imports between domains go through `index.ts` service exports; services must not expose raw tables/repositories. Database migration/seed tooling is the deliberate infrastructure exception. CI enforces boundaries. Only identity may call the cross-domain patient registry directly through a service contract where required.

## Milestone 1 — Infrastructure and data model

Deliver Docker Compose with health-checked PostgreSQL, Redis, and MinIO on loopback ports and named volumes. Separate migration-owner and runtime database roles. Commit Drizzle schema and forward-only migration; verify no audit update/delete grants. Development seed is explicit, deterministic, refuses production, and contains about 40 synthetic Turkish/international patients, realistic appointments, allergies, problems, observations and medication names. Seed clinical examples are test fixtures, not clinical reference data.

Model clinic, user, patient, care relationship, audit event, availability slot, appointment, encounter, problem, allergy, observation, versioned note, medication catalogue, prescription, charge and outbox. Every clinical table carries creator/updater timestamps and actor identifiers plus soft-delete metadata. The system actor owns imported/seeded records.

Acceptance: migrations apply once and re-running does not replay them; seed is repeatable without duplicating patients; DB constraints prevent overlapping provider slots, duplicate active bookings, and duplicate encounter charges. Verify grants as the runtime role, not the owner.

## Milestone 2 — Identity, access, and audit

Use opaque random Redis sessions with hashed lookup keys, HttpOnly/SameSite cookies, secure cookies outside local development, idle and absolute expiry, rotation, and revocation. Hash passwords using scrypt with per-password salts and constant-time verification. Throttle login and MFA attempts by keyed identifiers without storing email/IP in telemetry. Require TOTP MFA for clinicians, staff and admins; enrol only after password verification, encrypt secrets, reject replayed codes, and issue single-use recovery codes. Password reset and credential lifecycle UI belongs in the subsequent application milestone before production release.

Every patient service receives a server-resolved Actor. Authorize clinic scope, active user, MFA, patient self-access or explicit care relationship and purpose. Admin role alone grants no chart access. Explicit, time-limited break-glass access requires a reason, fresh MFA and an audit event; it never grants cross-clinic access. Recovery codes restore the ability to sign in, but do not count as fresh TOTP for break-glass.

Patient repositories write successful read/write audit events in the same transaction. Denials and emergency access use independent audit transactions so they survive the rejected operation's rollback. No PHI in operational logs or query strings. The runtime role has INSERT-only audit privileges; a separate audit-reader credential has SELECT-only access for the authorized viewer. A trigger also rejects audit mutation. Outbox records contain only identifiers.

Acceptance: real PostgreSQL service tests and hostile access matrix; Redis tests for MFA replay, session expiry, rate limits and revocation; no privileged session before MFA completion. Expose identity through same-origin Server Actions only; actions validate Zod boundaries and never accept actor/role from the browser.

## Milestone 3 — Design review (mandatory stop)

Build `/design` as a working component gallery with synthetic examples. Include Plex Sans and Plex Mono via `next/font`, exact warm-neutral OKLCH foundations, tuned dark theme, accessible foreground variants where necessary, 13px clinical and 17px patient density registers, 32px clinical rows, focus rings and reduced motion. No decorative gradients, static shadows, default palette, oversized radii or excessive cards.

Show buttons, text fields, select, checkbox, switch, textarea, status badges, data table, allergy strip, observations, typography, semantic tokens, empty state, layout-matched loading, inline validation, dialog, popover, tooltip and command palette. Include a dense clinical specimen and a calm patient specimen without creating the actual application screens. Provide interactive theme/density controls, keyboard shortcuts, meaningful preview feedback and mobile layouts.

Acceptance: keyboard and screen-reader checks, no serious accessibility violations, responsive review at 390/768/1440px, contrast review in both themes, focus trap/restore, no horizontal page overflow, production build. **Present the route and stop for the user's design review before implementing the nine application screens.**

## Milestone 4 — Patient screens, in brief order

1. `/patient/book`: provider/reason, availability, review/confirmation. Server-owned availability, transactional slot claim, conflict recovery preserving the patient's selections. Explicit confirmation before booking. Accessible date/time selection.
2. `/patient/appointments`: upcoming/past, preparation, cancel/reschedule with a deliberate second step. Reschedule must atomically claim the new slot and release the old one.
3. `/patient/visits/[uuid]`: published clinician-reviewed summary, issued medications and follow-up. Hide unsigned or unpublished notes. Plain language is authored/reviewed by the clinician; do not fabricate clinical summaries.

Build underlying services before wiring controls. The visit summary may correctly show its designed unpublished state until encounters are implemented. Never use fictional successful network responses.

## Milestone 5 — Clinician screens, in brief order

4. `/clinical/today`: time-ordered queue with wait time, reason and state; j/k navigation; command palette; correct empty, error and loading states. List access is scoped and audited, not a route around chart authorization.
5. `/clinical/patients/[uuid]`: persistent identity, allergies, active problems, observations, histories and section rail. Sex/age fields must be unambiguous; presentation values are derived from the patient's record, not used to infer identity.
6. `/clinical/encounters/[uuid]`: structured intake and template-driven note. Debounced autosave, revision checks, explicit saved/unsaved/failure indicators, protection against concurrent overwrite. Signing freezes that version; amendment creates a linked version with a mandatory reason and retains the prior text. Discharge creates/publishes a summary only after review.
7. `/clinical/encounters/[uuid]/prescribe`: searchable medication catalogue, dose/unit/route/frequency/duration, safety results, deliberate final review. Integrate a validated drug knowledge source before real prescribing. Local synthetic fixtures must be visibly distinguished from live safety checks; unavailable/stale checks block issuance. Document severity, provenance, check time and override reason. Hard stops cannot be overridden; permitted warnings require fresh clinician authorization and explicit justification.

Completion transaction verifies note/Rx states, records one charge in integer minor units, marks the encounter complete and writes identifier-only outbox events. Repeat submissions are idempotent. External Rx transmission happens after commit and has its own pending/sent/failed status. Internal Rx issuance is not proof of external delivery.

## Milestone 6 — Staff and background processing

8. `/staff/board`: staff-only waiting room queue, check-in/rooming/ready transitions, larger readable type. Do not display names or clinical reasons on a public lobby screen. Validate transitions server-side and show stale/disconnected state.

Run BullMQ in a separate process. Deliver appointment reminders through a selected provider, retry with exponential backoff, use stable job IDs, put exhausted jobs in a DLQ and expose operator retry. Outbox dispatcher is safe across retries/crashes. External requests use idempotency keys. Never put PHI in Redis job payloads or logs. Authenticate WebSocket upgrades, check Origin, authorize each clinic/patient subscription and periodically revalidate sessions. On reconnect, fetch a fresh authorized snapshot then resume events.

## Milestone 7 — Full verification and audit viewer

Run unit tests for dose, interaction and dates; Testcontainers service tests against real PostgreSQL/Redis; adversarial role, patient and clinic access tests; race tests for booking, note revisions and charge idempotency. Add E2E coverage of the complete thread, cancellation/reschedule, prohibited chart access, failed autosave and unavailable medication safety checks.

9. `/admin/audit`: access-controlled, paginated table, actor/patient/action/date filters, mono identifiers, no charts. Audit access to the audit viewer; do not place patient names in filter URLs. Admin audit privilege does not imply chart access. Show human-readable action text with immutable event IDs and clinic timezone.

Release requires production build, lint/type checks, integration/E2E pass, WCAG 2.2 AA review, backup restore, forward migration rehearsal, secret management, HTTPS, CSP, dependency advisory check, log-redaction checks and clinician workflow review. No claim of production readiness until these pass.

## Performance and UX acceptance

- Core Web Vitals: p75 LCP <=2.5s, INP <=200ms, CLS <=0.1, mobile and desktop measured separately.
- Proposed service budgets at 50 concurrent clinic users / 10,000 synthetic patients: routine reads p95 <=300ms, autosave acknowledgment <=1s, committed board updates <=1s. Validate on the intended hosting environment, record actual results and revise budgets explicitly if necessary.
- Server Components by default; client islands for interactive controls; minimum view-specific DTOs; no shared PHI caching. Pagination and purpose-built indexes before virtualization.
- 24-hour clinical timestamps; relative calendar dates within seven days in the clinic timezone; Plex Mono tabular values. Screen readers receive text status in addition to color.
- WCAG 2.2 AA, visible keyboard focus, 24px minimum target/spacing requirements, larger patient touch controls, zoom/reflow and reduced-motion support.
- Clinical operations are never optimistically marked complete. Harmless preference changes may be optimistic with rollback. Routine saves are quiet; failures appear beside the affected content.

## Sources and decisions

- Original user brief is the acceptance contract, including the design review stop.
- https://www.w3.org/TR/WCAG22/ — accessibility criteria.
- https://web.dev/articles/vitals — field performance thresholds.
- https://nextjs.org/blog — security releases; resolve and lock the newest available patched Next.js 15.
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html — session controls.
- https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html — MFA lifecycle.
