# Delivery status — 14 October 2026

## Current delivery — the complete visit thread

The project is now scoped as a **demonstration build**, not a deployment candidate: no certification, national-system integration or legal review is in scope. The request was to implement features, and this delivery adds the first complete vertical slice of the clinical workflow with real services behind it.

Five screens are implemented end to end: `/patient/book`, `/clinical/today`, `/clinical/encounters/[uuid]`, `/patient/visits/[uuid]` and `/admin/audit`. One patient can now be booked, moved through the waiting room, seen, have a note written, signed and amended, be charged once, and read the published summary their clinician wrote.

What is new behind those screens:

- **Scheduling services**: server-owned availability, transactional slot claiming that defers to the `active_slot_booking` partial unique index, a pure transition table with server-side role checks, and revision-checked appointment transitions.
- **Clinical services**: one encounter per appointment, note autosave guarded by a stored revision, signing that freezes a version, and amendment that creates a linked version while the signed text is retained by its database trigger.
- **Completion transaction**: verifies the note is signed, records exactly one charge in integer minor units, closes the appointment and enqueues identifier-only outbox events, all in one transaction. Repeat submissions return the committed result rather than charging twice.
- **Audit hash chaining** (`drizzle/0002_audit_hash_chain.sql`): each event stores a SHA-256 hash over its own fields and the previous event's hash, assigned by a `SECURITY DEFINER` trigger because the runtime role cannot read the log. `verify_audit_chain()` recomputes the whole chain and is granted only to the auditor credential. This upgrades the log from tamper-**resistant** to tamper-**evident**: the integration suite proves that a row altered by the table owner, bypassing the append-only trigger, is detected.
- **Audit viewer**: reads through the separate `meridian_auditor` credential, which holds no grant on `users` or `patients`, so no name can be resolved there even by an authorized administrator. Opening the log is itself an audited event, and administration still grants no chart access.
- **Note-drafting assistance** (optional): when `ANTHROPIC_API_KEY` is set, a clinician can request a draft built from the chart and their own notes. Only clinical facts are sent — no name, MRN, date of birth or internal identifier. The draft must be edited and signed by the clinician; nothing is saved or signed on their behalf. The feature hides itself when the key is absent.
- **Seed clinic day is now configurable.** `seedDatabase` still defaults to 21 September 2026 so the existing tests stay deterministic, while the command line seeds *today* and adds 48 unbooked slots across the following four days, so a fresh demo has both a populated clinic day and real future availability.

Verified on this host: TypeScript, ESLint including domain boundaries, **64 unit tests**, **27 Playwright tests** and a production build. The five new routes are server-rendered on demand at 107–156 kB first-load JavaScript; `/patient/visits/[uuid]` ships no client island at all.

**The integration suite still has not run.** Docker is not installed on this machine, so the 34 existing tests and the 13 new visit-thread tests did not execute. Those new tests are written and committed: they cover the complete thread, concurrent slot claiming, stale-revision rejection, signed-text preservation through amendment, charge idempotency, cross-patient summary denial, refusal to bill an unsigned note, and hash-chain tamper detection. Until they run against real PostgreSQL and Redis, every claim above about transactional and chaining behaviour is **unverified on this host**.

## Dependency advisories

Production dependencies report zero advisories and CI blocks on that gate (`npm audit --omit=dev`). Next.js is pinned to 15.5.27 for the SSG/ISR cache-poisoning advisory, and narrowly scoped overrides take patched `source-map-js` 1.2.2, `sharp` 0.35.5 and PostCSS 8.5.28. Revalidate those overrides when upgrading their parent dependencies.

Development-only advisories are reported without blocking, because one of them has no fix to take. The `braces` stack-exhaustion advisory ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)) affects every published version of the package, so no override resolves it. It reaches this project only through `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`, at lint time, matching globs over paths in this repository; it is absent from the application's own dependency tree and never runs against untrusted input. The only fix `npm audit fix --force` offers is downgrading to `eslint-config-next@14.2.35`, which would lint a Next.js 15 application with Next.js 14 rules. Revisit when `braces` publishes a patched version.

## Previous delivery — marketing and account flows

Following the design revision, the user requested a marketing homepage and sign-in/sign-up flows. Those routes are now implemented. `/design` remains a synthetic interactive preview; `/dashboard` is an authenticated account welcome screen that now routes each role to its starting screen.

## Marketing and account flows

- `/` is a responsive, server-rendered marketing homepage with a custom product illustration, platform/experience sections, access controls overview, working FAQ, mobile navigation, and account/preview links.
- `/sign-up` collects clinic-owner details, validates a 15-character minimum password and confirmation, creates a new clinic and administrator in one audited transaction, and starts mandatory MFA enrollment. A public caller cannot choose an existing clinic or elevate an account in another clinic.
- `/sign-in` uses the existing credential services. The UI handles authenticator enrollment, verification, single-use recovery codes, clear errors, pending submissions, password visibility and keyboard focus. Setup uses a manual time-based authenticator key.
- `/dashboard` checks the Redis session against the current database user and shows the signed-in clinic/account summary. Its preview link is explicitly synthetic. Sign-out revokes the session before deleting the cookie.
- Authentication challenges and sessions use HttpOnly, SameSite Strict cookies. Exact origin checks reject unconfigured origins; public deployments require HTTPS. Known local origins permit HTTP on development ports. Passwords, session tokens and challenge tokens are not written to URLs or browser storage.
- The gallery brand now returns to the homepage; leaving its dark theme restores the public page theme.

Verified: production build, TypeScript, ESLint, **47 unit tests**, the existing **9 design browser tests**, and **9 new public/auth browser tests**. New pages pass automated WCAG checks and overflow checks at 360/390/768/1440px. Inspected desktop and mobile screenshots. A decorative orbit overflow discovered in the first browser run was corrected and all nine public tests reran successfully.

Both ports serve the same application: `http://127.0.0.1:4000/` and `http://127.0.0.1:4001/`. The homepage, sign-in, sign-up and design routes returned HTTP 200 on each. Browser tests verified that an anonymous or malformed-session visit to `/dashboard` navigates to `/sign-in`.

**Live authentication remains blocked by local infrastructure.** This machine has no configured `.env.local` or Docker installation. The integration suite was attempted again and failed its container startup with `Could not find a working container runtime strategy`; all **34 integration tests were skipped**, including the new registration/isolation/MFA/recovery transaction scenario. Unit action tests use mocked services and do not prove database behavior. Public forms clearly show the unavailable state instead of generating fake accounts or sessions. Follow the README's infrastructure setup before using account flows.

Registration creates an isolated clinic; it does not verify email ownership. Email verification/reset, invitations, credential lifecycle administration, and a trusted reverse-proxy address adapter remain required before public production use. The web adapter deliberately uses conservative shared and account request limits instead of trusting client forwarding headers.

The homepage is statically prerendered with **107 kB** first-load JavaScript; sign-in/sign-up report **112 kB**. The existing design gallery now reports **193 kB**. Illustrations are inline SVG/CSS with no new image or animation dependencies. These are build-size measurements, not field performance benchmarks.

Review images: `.artifacts/meridian-home-1440.png`, `.artifacts/meridian-home-390.png`, `.artifacts/meridian-sign-in-1440.png`, `.artifacts/meridian-sign-in-390.png`, `.artifacts/meridian-sign-up-1440.png`, and `.artifacts/meridian-sign-up-390.png`.

## Visual revision 02

Reworked the preview following feedback that the first version was too crude and lacked a polished visual identity. The revised composition has a custom Meridian mark, a larger editorial introduction, an inline vector connected-care illustration, clearer navigation and surface hierarchy, a selectable appointment timeline, visit-progress graphics, synthetic systolic-pressure trends, and a patient calendar illustration that reflects the chosen appointment time. The clinical specimen retains compact rows, while the patient specimen retains its larger type and controls. Graphics use SVG/CSS without additional image downloads or animation libraries.

Reverified the production build (including TypeScript), ESLint, and all nine Playwright tests after this revision. Both density modes pass automated accessibility checks in light/dark themes, and 390/768/1440px layouts pass the overflow checks. Inspected focused screenshots for desktop, dark mode, mobile and the patient specimen. Both `http://127.0.0.1:4000/design` and `http://127.0.0.1:4001/design` returned HTTP 200 with the revised content. The two ports serve the same preview application.

Focused review images: `.artifacts/meridian-refresh-desktop.png`, `.artifacts/meridian-refresh-dark.png`, `.artifacts/meridian-refresh-mobile.png`, and `.artifacts/meridian-refresh-patient.png`.

## Implemented

- Medium-sized modular structure with identity, scheduling, clinical and billing domains; public service boundaries enforced with ESLint.
- Next.js 15.5.25 App Router, TypeScript strict, Tailwind v4, Radix, Plex Sans/Mono via `next/font`.
- Docker Compose definition for PostgreSQL, Redis and MinIO; separate owner, runtime and audit-reader database roles.
- Sixteen Drizzle tables, a generated initial migration, and a custom forward migration for cross-domain foreign keys, slot exclusion, immutable provenance/signed notes, append-only audit and grants.
- Deterministic development seed for 40 synthetic patients, 36 slots, 12 appointments, coherent sample records and one draft encounter.
- Identity service code: scrypt passwords, encrypted TOTP enrollment, MFA challenges/replay checks, single-use recovery codes, rate limits, Redis sessions and revocation, current-user checks, care relationships, purpose authorization, expiring read-only break-glass and audit wrapper.
- Light/dark design library: both density registers, interactive queue, patient booking specimen, controls, inline validation, amendment confirmation, empty/loading/error states, command palette, keyboard navigation, responsive layouts and reduced motion.
- Unit, Testcontainers and browser test suites; CI workflow definition; setup and delivery documentation.

## Foundation verification before the account-flow addition

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

`/design` now reports 189 kB of first-load JavaScript (86.9 kB route plus shared code), compared with 187 kB before the visual refresh. The gallery intentionally imports every interactive primitive. Clinical routes should use smaller client islands. This build-size observation is not a Core Web Vitals or concurrency benchmark. Field performance, backend load, manual assistive-technology testing, real clinician usability, backup restore and production security review remain required.

## Review artifacts

Generated screenshots (ignored by Git) are in `.artifacts/`:

- `design-clinical-1440.png`
- `design-clinical-dark-1440.png`
- `design-patient-1440.png`
- `design-clinical-390.png`, `design-patient-390.png`
- `design-clinical-768.png`, `design-patient-768.png`

## Remaining clinical implementation

Finish credential lifecycle and infrastructure verification, then the nine screens in brief order with real scheduling/clinical/billing services. Complete transactional booking/rescheduling, chart reads, encounter autosave/sign/amend, medication safety integration and prescription issue, idempotent charge generation, published visit summaries, reminders, BullMQ outbox dispatch, authenticated WebSockets and the audit viewer. Add service tests as each service is implemented and extend E2E coverage to the complete visit thread.

No live drug-interaction provider, e-prescribing provider, reminder transport, payment processor or deployment is configured. Those boundaries are listed explicitly in the implementation plan. No patient booking, prescription, charge or notification is performed by a gallery control.
