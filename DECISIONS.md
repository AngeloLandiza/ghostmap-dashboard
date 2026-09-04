# Decisions — ghostmap-dashboard

Non-obvious choices, newest first. See `docs/PLAN-PHASE2.md` for the cross-repo contract.

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
