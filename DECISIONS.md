# Decisions — ghostmap-dashboard

Non-obvious choices, newest first. See `docs/PLAN-PHASE2.md` for the cross-repo contract.

## E2E, the device simulator and CI (2026-09-04)

**The simulator speaks pure REST, no Ably client.** `POST /v1/sessions/:id/keyframes` already
makes the backend publish the `keyframes` realtime message itself (API.md), so
`scripts/simulate-device.ts` never needs an Ably SDK — it just registers keyframes on a
schedule. That keeps it a small, dependency-free `tsx` script instead of a second realtime
client to maintain.

**One static test object, not a growing point cloud.** The 500 inline points describe a
stationary 0.8 m cube with a different colour per face, generated once and sent unchanged with
every keyframe — a real phone keeps re-observing the same room, and a fixed, colour-coded
shape is easy to recognise as "the simulator's output" in the live viewer at a glance. Only the
camera pose moves (a fixed-speed orbit around the cube, independent of `--seconds`), which is
what actually exercises the trajectory and frustum rendering.

**`e2e/` stays the test directory, not `tests/e2e/`.** `playwright.config.ts` already points
`testDir` at `./e2e`, and the scaffold's `e2e/README.md` already described this flow — adding a
second, empty test directory would just be dead structure Playwright never runs.

**A few `data-testid`s were added deliberately, not everywhere.** `ParticipantsPanel`'s rows
(plus `data-participant-kind` and `data-left`) and `LiveStatsBar`'s counters (`stat-keyframes`,
`stat-points`, ...) are the only reliable way to assert "a device joined" and "the keyframe
count is growing" without depending on copy that is free to change. Nothing else in the app
carries one; add more only where a test would otherwise have to key off wording or layout.

**The E2E suite skips itself instead of failing when secrets are absent**, both locally
(`test.skip` on missing `E2E_API_BASE`/`E2E_ADMIN_API_KEY`/`E2E_CLIENT_ACCESS_KEY`) and in CI
(the `e2e` job checks the same three repository secrets at runtime and no-ops if any are
blank). Forked-PR runs never see secrets, and a fresh clone of this repo has no backend to
test against yet — neither should turn CI red.

## Scaffold, auth and app shell (2026-09-04)

**Responses are normalized to camelCase in one place.** The backend serves two casings at
once: rows selected with Drizzle serialize as `camelCase` (`pointCount`, `sizeBytes`) while
hand-built payloads use `snake_case` (`participant_count`, `can_join`, `share_url`). Rather
than sprinkle `a ?? b` through the UI, `flex()` in `src/lib/api/types.ts` preprocesses each
response object, adds a camelCase alias for every snake_case key and validates the result.
Only the top level is touched, so opaque blobs (`manifest`, `origin`, `intrinsics`, the Ably
token request) keep their own keys.

**A schema mismatch warns; it does not throw.** Phase 2 backend work lands concurrently with
this dashboard, so every field has a fallback (`''`, `0`, `null`, `[]`) and `request()`
returns the raw payload with a console warning when validation fails. A half-finished
endpoint degrades a panel instead of blanking a page.

**Admin is detected by probing, not by claiming.** `useAuth()` runs `GET /admin/overview`
with whatever token is stored and only a 2xx sets `isAdmin`, exactly as PLAN section 4
specifies. A 401 there means the token is expired or revoked, so the session is cleared; a
403 is the normal answer for a signed-in Google user and just hides the admin nav.

**The API base is overridable at runtime.** `localStorage["ghostmap.apiBase"]` beats
`VITE_API_BASE`, so one static deployment can be pointed at a preview backend without a
rebuild. Query keys are namespaced by the active base and the cache is cleared on change, so
rows from one backend can never be shown for another. `/settings` is deliberately reachable
while signed out — a wrong base URL has to stay fixable.

**Every route is a lazy chunk.** three.js belongs to `/maps/:id` and `/parties/:id`, recharts
to `/admin/costs`, ably to the live party view. Keeping those imports inside the lazy pages
holds the entry bundle at roughly 210 kB (68 kB gzipped) with no 3D or charting code in it.

**Bearer tokens live in `localStorage`, not cookies.** The backend is a separate origin and
takes `Authorization: Bearer`, there is no cookie session to piggyback on, and the E2E suite
needs to inject an admin key directly. The trade-off (XSS can read the token) is accepted for
an operator dashboard; the app ships no `dangerouslySetInnerHTML` and no third-party script
except Google Identity Services, which is loaded on demand from `/login`.

**Deps are pinned to React 18.** `@react-three/fiber` v9 requires React 19; the contract
names React 18, so fiber v8 and drei v9 are the matching pair.
