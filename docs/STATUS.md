# Reliability implementation ? 19 October 2026

Local branch: `fix/clinic-workflow-reliability`. Changes have not been pushed or deployed. This section supersedes the older verification snapshot below.

## Implemented in this pass

- Development, production and browser-test builds use separate output directories. Browser tests own port 4013. Worker/realtime commands load local configuration under the React server condition, validate required settings and close runtime connections on shutdown.
- The note editor serializes autosaves, retains later edits while a request is pending, preserves failed/conflicting text and flushes before review. The signature commits the reviewed text and signature together. Navigation and reload warn when text is unsaved.
- Starting a visit through the action updates its appointment and creates the encounter/note in one transaction. Stale starts roll back. Completion now refuses a mismatched appointment state and rolls back its charge, summary and outbox events.
- Invoice payment, voiding and line removal share their audit transaction. Staff/admin billing authority is validated independently of chart access. Staff can reach invoices; price-list administration remains admin-only. Billing load errors are visible.
- Mail jobs throw on missing configuration or provider failure and reuse delivery idempotency keys. Queue errors store fixed operational codes. Outbox counts are clinic-scoped and the screen distinguishes queue handoff from delivery. Live subscriptions refresh after reconnect.
- Observation rows retain encounter provenance, protected by a composite foreign key. Assisted drafts include only observations from that encounter; legacy unlinked observations are not presented as current-visit measurements. The editor explains the external AI data transfer and the provider call has a bounded timeout.
- Prescription issuance rejects checks older than 15 minutes, replaced checks, and checks preceding an allergy/prescription change. Application clinical writes serialize by patient. Database mutation timestamps use the time after lock waits.
- Upload URLs sign a create-only condition, preventing replacement through a reused upload URL. Bucket initialization is explicit; successful uploads refresh the chart. Real object-store regression coverage has been added but is not yet verified here.
- Appointment lists have separate upcoming/history pages of 25 rows. Scheduling and displays use the stored clinic timezone. Authentication can use an explicitly trusted proxy address header; absent/invalid/untrusted headers use the existing shared fallback. The administrator waiting-room view is labelled as read-only.

## Verification on this workstation

- Production build: passed.
- Unit tests: 100 passed. Includes delayed autosave/error/conflict cases, real Node process import/configuration checks, mail failures and trusted-header handling.
- Final type check, lint and whitespace checks: passed.
- Focused database checks: 73 tests across visit thread, chart entry, prescribing, billing, patient appointments and outbox pass across the corrected runs. These use fresh local PostgreSQL 17 databases with the repository Redis mock; this is **not** a full Testcontainers pass.
- A separate queue retry regression passed against the real local Redis broker, using a unique disposable BullMQ queue and mocked mail HTTP responses. A 503 is retried using the same idempotency key, and the job completes only after a 200 response. No message was sent.
- Final isolated browser run: all 30 public/design/anonymous checks passed, including automated accessibility checks.
- Docker initially ran the visit suite, then became unresponsive. Subsequent container startup timed out and the run was stopped. Real MinIO upload/CORS/overwrite tests and the full PostgreSQL/Redis/MinIO suite remain unverified.

Migration 0014 was exercised only in disposable test databases. The application's development database and any hosted database were not migrated.

## Remaining implementation and release work

1. Restore the Docker test runtime and pass the complete integration suite, particularly MinIO conditional uploads and browser CORS.
2. Add durable downstream delivery status and operator retry for exhausted BullMQ jobs; outbox dispatch status alone is insufficient. Verify the selected provider's idempotency retention and delivery callbacks.
3. Complete document content validation/scanning and cleanup of abandoned uploads. Validate production object-store policy, CORS, encryption and retention.
4. Add authenticated browser coverage for patient booking/rescheduling, staff check-in, clinical note conflict/signing, billing, and denied cross-clinic access. Current browser evidence is limited to public/design/anonymous routes.
5. Validate the prescribing provider and complete active-medication/context coverage across encounters. The new freshness guard is an application boundary, not clinical validation or prescription transmission.
6. Measure performance and accessibility with the full authenticated workflow and realistic synthetic volumes. No production latency or field accessibility claim is made here.
7. Rehearse forward migration, backup restore and recovery in staging; configure hosting, HTTPS, secrets, monitoring and approved providers. Deployment, live delivery, physical workflow review and restore verification remain pending.

---

# Delivery status — 16 October 2026

Meridian is a demonstration clinic platform. Nothing here concerns certification, national-system
integration or legal review; what follows is feature work and how it was verified.

## Where the project stands

A clinic created through `/sign-up` can now be run end to end by the people who work in it. The
administrator confirms their address, invites colleagues, authors availability and a price list;
the front desk registers patients and runs the waiting room; a patient books, moves or cancels a
visit and reads what it cost; a clinician records the encounter, prescribes, and signs the note
that closes it. Nothing in that path depends on `scripts/seed.ts`.

Twenty-four screens, four domain modules, two background processes:

| Area | Screens |
| --- | --- |
| Public and account | `/`, `/sign-in`, `/sign-up`, `/accept-invite`, `/forgot-password`, `/reset-password`, `/verify-email`, `/account/security` |
| Administration | `/admin/people`, `/admin/schedule`, `/admin/access`, `/admin/services`, `/admin/reports`, `/admin/outbox`, `/admin/audit` |
| Front desk | `/staff/board`, `/staff/patients` |
| Clinical | `/clinical/today`, `/clinical/encounters/[uuid]`, `/clinical/encounters/[uuid]/prescribe`, `/clinical/patients/[uuid]` |
| Patient | `/patient/appointments`, `/patient/book`, `/patient/visits/[uuid]` |

`npm run worker` drains the outbox and runs jobs; `npm run realtime` serves live updates.

## This delivery

**Two defects first.** `startVisitAction` ignored a failed appointment transition, so a stale
revision could leave an appointment on `ready` while the visit went on to bill; it now tolerates
only the idempotent case where the appointment already reached `in_progress`. `/admin/audit`
rehashed the whole log on every page view, which checkpointed verification replaced.

**Making a self-created clinic usable.** People management with single-use invitations whose
tokens are stored only as a peppered hash, which is what finally calls `revokeAllSessions`.
Weekly availability patterns expanded into bookable times, where overlap is refused by an
`EXCLUDE USING gist` constraint rather than searched for, and each candidate slot is inserted in
its own savepoint so `no_provider_slot_overlap` reports what is already there. Patient
registration with the clinic's next record number, and portal invitations reusing the invitations
table under a check constraint mirroring `users.patient_link_role`. Care relationships granted by
the workflow itself — scheduling authority at booking, clinical authority on arrival — with the
front desk authorized by the visit instead of a standing grant, so a colleague invited today can
run today's waiting room. Password reset, email verification and authenticator re-enrollment,
built on the Redis conventions already here.

**Finishing the clinical thread.** Vitals, problems and allergies recorded during the encounter,
each reading stored with the reference range it was judged against. Prescribing behind a
pluggable safety boundary whose default provider calls itself `synthetic-fixture`, which
`issued_requires_safety` refuses to accept behind an issued row — so this build drafts and checks
but cannot issue, and the tests prove that holds even against direct SQL. The patient chart view,
the way into break-glass, patient appointments with a reschedule that swaps slots in one
statement, and the staff board, which selects no patient column at all because it faces a room.

**Turning on the platform.** A dispatcher claiming outbox rows with `FOR UPDATE SKIP LOCKED` and
enqueuing each under its own idempotency key, with backoff, dead letters and an operator retry
screen. Appointment reminders keyed on the appointment and the offset, so rescheduling cancels and
reissues. Checkpointed chain verification with a scheduled full pass, because an alteration before
a checkpoint is invisible to anything else. A price list replacing the hardcoded consultation fee,
with the invoice total maintained by a trigger from its lines. Attachments in the object store
behind per-request presigned URLs, checked against what was stored before they join a chart. Live
updates that carry no content, so the screen re-reads an authorized snapshot rather than replaying
a cursor.

## Verification

Measured on this host on 16 October 2026:

| Check | Result |
| --- | --- |
| TypeScript | pass |
| ESLint, including domain boundaries | pass, 0 warnings |
| Unit tests | 91 / 91 |
| Integration tests against real PostgreSQL 17.5 | 189 / 189 |
| Browser tests, including axe on every public page | 30 / 30 |
| Production build | pass, 29 routes |

Docker Desktop still cannot start on this workstation — its service needs elevation this session
does not have — so Testcontainers cannot run here. PostgreSQL 17.5 was instead started directly
from npm-published binaries, and the committed integration suites were run against it through a
local, untracked harness that substitutes the same bootstrap. Every suite passes that way except
the socket-level realtime suite, which needs real Redis pub/sub and runs in CI; its authorization
and parsing rules are unit-tested here instead. Redis itself is substituted in the harness, so
anything that turns on real Redis semantics is proven in CI rather than locally.

Two defects were found by tests written during this delivery: minute figures in the clinic report
were typed as numbers while the driver returned strings, and realtime channel validation used
`in`, which walks the prototype chain and let a subscriber ask for `toString`.

## Dependency advisories

Production dependencies report zero advisories and CI blocks on that gate
(`npm audit --omit=dev`). Next.js is pinned to 15.5.27 for the SSG/ISR cache-poisoning advisory,
and narrowly scoped overrides take patched `source-map-js` 1.2.2, `sharp` 0.35.5 and PostCSS
8.5.28. Revalidate those overrides when upgrading their parent dependencies.

Development-only advisories are reported without blocking, because one of them has no fix to take.
The `braces` stack-exhaustion advisory
([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)) affects every published
version of the package, so no override resolves it. It reaches this project only through
`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`, at lint time,
matching globs over paths in this repository; it is absent from the application's own dependency
tree and never runs against untrusted input. The only fix `npm audit fix --force` offers is
downgrading to `eslint-config-next@14.2.35`, which would lint a Next.js 15 application with
Next.js 14 rules. Revisit when `braces` publishes a patched version.

## What is deliberately not built

Prescription transmission to a pharmacy, a real drug knowledge base, insurance claims, multi-clinic
tenancy for one person, and any integration with a national health system. The prescribing safety
seam and the mail and object-store seams are where a real provider would attach; each one is
honest about being unconfigured rather than pretending to work.
