# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

יד שרה emergency-medicine patient-flow system: reception → queue → treatment → discharge/export.
Hard requirements that shape the architecture: **strict medical-grade security (PHI)**, **multi-user
concurrent editing of the same form without overwrites**, and Hebrew/RTL by default.

> **Hosting direction changed (2026-06-19): the system runs web-hosted.** The original
> "fully On-Prem / air-gapped / no internet in the critical path" constraint is **DROPPED** — internet
> in the critical path is now permitted (e.g. AI-based department routing at reception). The
> offline-first design of reference data (drug catalog, streets catalog) stays as a useful pattern but
> is **no longer a hard constraint**. Treat the On-Prem / offline / air-gap language in
> `docs/architecture.md` as historical background, not a binding requirement. PHI-security, concurrency,
> and RTL requirements are unchanged.

> Note: `docs/architecture.md` is the original planning doc and says "planning phase, no code yet."
> That is outdated — the system is implemented. Treat that doc as design intent, not current state.

## Stack

- **Backend:** ASP.NET Core (`net10.0`), EF Core + Npgsql → PostgreSQL 17, SignalR, JWT bearer.
- **Frontend:** React 19 + TypeScript + Vite, Mantine 9 (UI), TanStack Query (server state),
  Zustand (`store/auth.ts`), react-router 7, `@microsoft/signalr`.

## Run / build / test

PostgreSQL runs as a **native Windows service** on this machine (not Docker — the `docker-compose.yml`
exists but is not used for local dev). Dev DB connection lives in
`src/Server/YadSarah.Api/appsettings.Development.json` (gitignored).

```bash
# Backend — http://localhost:5000 ; migrations + setting defaults run automatically on startup
cd src/Server/YadSarah.Api && dotnet run

# Frontend — http://localhost:5173 (Vite proxies /api and /hubs to :5000)
cd src/Client && npm install && npm run dev

# Lint client / production build
cd src/Client && npm run lint
cd src/Client && npm run build      # tsc -b && vite build

# EF Core migrations (run from the Api project dir so config/connection resolve)
cd src/Server/YadSarah.Api && dotnet ef migrations add <Name> --project ../YadSarah.Infrastructure
cd src/Server/YadSarah.Api && dotnet ef database update
```

There is **no automated test suite** yet. Verification is manual end-to-end (run both, walk a patient
through the flow) plus the `ui-probe` skill for adversarial UI testing.

To get a populated queue for the demo, use the Demo subsystem ("מלא את התור") — see Demo below.

## Backend architecture (clean layering)

`src/Server/` solution, 4 projects with one-directional references (Api → Application → Infrastructure → Domain):

- **`YadSarah.Domain/Entities`** — entities + the `UserRole` enum, no dependencies.
- **`YadSarah.Application/Services`** — all business logic (`AuthService`, `VisitService`,
  `FormService`, `AuditService`, `MedicationCatalogService`, etc.) + policy classes
  (`FormSectionPolicy`, `PasswordPolicy`). **Put business rules here, not in controllers.**
- **`YadSarah.Infrastructure/Data`** — `AppDbContext`, `Migrations/`.
- **`YadSarah.Api`** — thin controllers, SignalR `Hubs/MainHub.cs`, `Middleware/`, `Converters/`,
  `Program.cs` (DI wiring, auth, rate limiting, CORS). Services are registered `Scoped`;
  `FormPresenceService` is a `Singleton` (holds live presence state).

## Cross-cutting conventions you must respect

- **Field/section RBAC is mirrored in two files — keep them in sync.** The single source of truth on
  the server is [src/Server/YadSarah.Application/Services/FormSectionPolicy.cs](src/Server/YadSarah.Application/Services/FormSectionPolicy.cs);
  the client mirror is [src/Client/src/constants/formPolicy.ts](src/Client/src/constants/formPolicy.ts).
  Section keys must match exactly across both. The nurse-editable mapping is a client-pending TODO.

- **`UserRole` enum order is load-bearing.** `Reception, Nurse, Doctor, Admin, ShiftManager` — values
  are persisted as ints, so `ShiftManager` was appended (=4) rather than inserted. Never reorder.

- **Form concurrency = three layers** (in [FormService.cs](src/Server/YadSarah.Application/Services/FormService.cs)):
  optimistic `MedicalForm.Version` int (caller passes `expectedVersion`, mismatch → `ConcurrencyException`);
  soft `FormLock` per section with a 5-min TTL; and SignalR presence broadcast via `MainHub`.

- **Form lifecycle / signing.** A doctor signing locks the form (treatment ends). Only ShiftManager/Admin
  may edit within the `PostSignEditWindow` (10 min, in FormService). After signing, further changes go in
  separately-signed **addenda** (`AddendaJson`). Per-section last-editor is tracked in `FieldEditsJson`.
  Signing (and signing an addendum) requires **step-up re-auth**: the clinician re-enters their own
  username + password in `ReauthModal`, verified server-side against the logged-in user.

- **Drug catalog is offline-first reference data (non-PHI).** Source of truth is the local `Medication`
  table, fed by two interchangeable full-snapshot syncs (`MedicationCatalogService.ReplaceAllAsync`):
  the MoH registry API (`MedicationSyncService.SyncFromApiAsync`, the configurable `MedApiUrl` behind a WAF)
  and an admin-uploaded CSV/XLSX file (the offline fallback). A failed sync **never throws into the app** —
  it records status and leaves the last good snapshot serving autocomplete. `MedicationSyncBackgroundService`
  re-syncs on the `MedSyncIntervalDays` cadence (default 7d). `GET /api/medications/frequent` pre-populates
  the picker with the signed-in doctor's most-used drugs before any search.

- **MedicalForm storage is hybrid:** plain text sections are columns; table sections (allergies, vital
  signs, treatments, diagnoses, routing, etc.) are JSON string columns (`*Json`) whose shape is documented
  inline in [MedicalForm.cs](src/Server/YadSarah.Domain/Entities/MedicalForm.cs).

- **Audit every PHI access/change.** Use `AuditService.LogAsync(...)` with the action-verb constants it
  exposes (`Viewed`, `Updated`, `Signed`, `Login`, ...). The audit log is append-only.

- **Auth wiring.** JWT carries `fullName` + role claims. Client stores the token in `localStorage`
  under `auth_token`; a 401 from `api/client.ts` clears it and redirects to `/login`. SignalR reads the
  token from the `access_token` query-string param (see `Program.cs` `OnMessageReceived`).

- **System settings are key/value rows, not config.** Keys are `const`s on `SettingsService`
  (`queue.resetHour`, `medications.*`); `EnsureDefaultsAsync()` seeds defaults on startup (called in
  `Program.cs` right after `Database.Migrate()`). Write via `SetAsync(key, value, userId)` (user-attributed,
  audited) or `SetSystemAsync` (unattributed machine writes, e.g. sync metadata). The daily queue counter
  (`QueueCounter`) rolls over at `queue.resetHour` (default 18:00 Israel time).

## Frontend architecture

`src/Client/src/` is feature-organized:
- `features/{reception,queue,treatment,history,admin,auth}` — pages/screens; routes are declared in
  [App.tsx](src/Client/src/App.tsx) behind `RequireAuth`. `admin/` also hosts the audit-log, settings,
  and feedback-review screens.
- `api/*.ts` — typed wrappers over the shared `api` helper in [api/client.ts](src/Client/src/api/client.ts).
- `realtime/hub.ts` — SignalR connection. `store/auth.ts` — Zustand auth state.
- `constants/` — `departments.ts` (queue/department model) and `formPolicy.ts` (RBAC mirror, above).
- `components/FeedbackWidget.tsx` — app-wide in-app bug/feedback reporter (`FeedbackController` →
  `FeedbackReport`), surfaced to admins on the feedback-review screen.

## Security & guardrails

- **PHI source material is never committed:** `videos old/`, `frames/`, `audio/`, media files (recordings
  & screenshots of the existing live system) are gitignored. Do not add them.
- Security model lives in `docs/security/` (legal requirements, controls, pentest report). Hardening
  already in place: rate limiting (strict `auth` policy + global), `SecurityHeadersMiddleware`, HSTS +
  HTTPS redirect in production, sanitized `ProblemDetails` (no stack traces).
- A repo hook (`.claude/settings.json`) flags security-relevant edits and runs a **security-review gate
  on Stop**. If a Stop is blocked for a pending security review, run `/security-review` before finishing.
- **Demo subsystem** (`DemoController`, `DemoDataService`) is gated by `Demo:Enabled` (on in Development)
  **and** Admin role; it wipes/seeds test data, so never enable it in production.

## Working-style note (from global prefs)

Plan non-trivial work and get approval before writing code unless told "תבנה"/"build". Confirm scope/cost
before any paid API/LLM or bulk run. Default working language with the user is Hebrew.
