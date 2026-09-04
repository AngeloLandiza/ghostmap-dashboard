# Ghostmap Phase 2 — Dashboard, accounts, parties, costs, E2E

Cross-repo contract for three code bases. Every agent implementing part of it MUST follow the names and shapes here exactly.

| Repo (local path) | Stack | Deploy |
|---|---|---|
| `~/Documents/GitHub/ghostmap-backend` | Hono + TS on Vercel Node runtime, Neon Postgres (Drizzle HTTP), GCS, Ably, BigQuery, New Relic | https://ghostmap-backend.vercel.app |
| `~/Documents/GitHub/ghostmap-dashboard` | Vite + React 18 + TS + Tailwind + React Router + TanStack Query + three.js (React Three Fiber) + ably + recharts + zod, Playwright E2E | Vercel static (SPA rewrite) |
| `~/Documents/GitHub/apple-VSLAM-client` (branch `dev`) | iOS app "RoomMapper"/Ghostmap: SwiftUI + ARKit + Metal, Swift 6, MapCore package, no third-party dependencies | device via `scripts/rm.sh` |

Guiding constraints: keep every provider inside its free tier as long as possible; no third-party SDKs on iOS; secrets never in git; every non-obvious choice recorded in each repo's DECISIONS.md.

## 1. Identity and access

Roles (JWT claim `role`): `admin` (ADMIN_API_KEY or admin JWT), `worker`, `user` (Google account), `device` (a phone bound to a user), `client` (legacy access key, read-only).

### Google sign-in
- Env (backend): `GOOGLE_CLIENT_IDS` = comma-separated allowed audiences (web client id, iOS client id).
- `POST /v1/auth/google` body `{ "id_token": string, "device"?: { "id": uuid, "name": string, "platform": "ios"|"ipados"|"web" } }`
  - Verify with `google-auth-library` `OAuth2Client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_IDS })`; reject unverified emails.
  - Upsert `users` (`id` uuid, `google_sub` unique, `email`, `name`, `picture_url`, `created_at`, `last_login_at`).
  - With `device`: upsert `devices` row with `user_id`; return `{ token, expires_at, role: "device", device_id, user }` (30-day JWT with `user_id` + `device_id`).
  - Without: `{ token, expires_at, role: "user", user }` (7-day JWT with `user_id`).
- `GET /v1/auth/me` → `{ role, user?, device_id? }`.
- The dashboard "admin key" box sends `ADMIN_API_KEY` as the bearer; `GET /admin/overview` succeeding is the signal to show admin UI.
- JWT claims: `role`, `user_id?`, `device_id?`, `email?`. `Principal` gains `userId?`.

### Ownership and visibility
- `maps.owner_user_id`, `sessions.owner_user_id` (nullable for legacy rows).
- A `user`/`device` may read: maps they own, maps whose `session_id` is a session they participate(d) in, and sessions they participate(d) in or own. Admin reads everything. Writes require ownership (map) or participation (session).

## 2. Parties (collaborative sessions)

- `sessions` gains `invite_code` (8 uppercase base32 chars, unique), `max_participants` (default 4), `owner_user_id`, `share_url` (derived: `${DASHBOARD_URL}/join/${invite_code}`; env `DASHBOARD_URL`).
- `session_participants` gains `user_id`, `kind` (`"device"` mapper or `"viewer"`), `color` (hex assigned on first join from a fixed palette of 8), `display_name`.
- **Cap:** at most `max_participants` (4) distinct active users (rows with `left_at IS NULL`, distinct `user_id`; legacy devices without a user count individually). Joining when full → `409 { error: { code: "session_full" } }`. Joining an ended session → `410 { code: "session_ended" }`.
- Rejoin is always allowed: joining again clears `left_at` and keeps the color.
- Endpoints:
  - `POST /v1/sessions` (user or device) `{ name, origin?, base_map_id?, max_participants? }` → `201 { session, participants, channel, share_url }`. The creator becomes owner; a device creator is also a `device` participant (leader).
  - `GET /v1/sessions/by-code/:code` (any authenticated role) → `{ session: { id, name, status, origin, participant_count, max_participants, owner_name }, can_join: bool, reason?: "session_full"|"session_ended" }`.
  - `POST /v1/sessions/join` `{ code, kind?: "device"|"viewer" }` (kind defaults to `device` for device tokens, `viewer` for user tokens) → `{ session, participants, channel, share_url, me: participant, realtime: { token_request, channel, can_publish } }`.
  - `POST /v1/sessions/:id/leave`, `POST /v1/sessions/:id/end` (owner, leader device or admin), `GET /v1/sessions/:id` (participants include `kind`, `color`, `display_name`, `user_id`, `left_at`).
  - Existing keyframe endpoints stay; `Keyframe` gains optional `aligned: boolean` (default true) meaning the pose is expressed in the session origin frame. Unaligned keyframes are stored but the realtime message carries `aligned:false` so viewers can grey them out.
- Realtime channel `session:<id>` (Ably):
  - Server-published: `keyframes` `{ device_id, user_id, color, keyframes: [{ seq, t, pose, intrinsics, tracking_state, aligned, depth_ref, points_inline }] }`, `participant` `{ event: "joined"|"left", participant }`, `session` `{ event: "ended" }`, `merge` `{ … }`.
  - Client-published (devices, ≤ 10 Hz): `pose` `{ device_id, t, pose: [16 floats], aligned }`.
  - Presence: every client enters with `{ user_id, display_name, kind, color }`.
- Ably token capability: participants (device or viewer) get `publish, subscribe, presence, history` on their session channel; non-participants get `subscribe, presence, history` only when the session is public (not needed now → deny with 403).

## 3. Costs — "see all the costs"

Backend module `src/lib/costs/`:
- `pricing.ts` — one table of providers/metrics with **unit prices, free quotas, `as_of` date and `source` URL**. Providers: Google Cloud Storage (standard, us-east1: storage GB-month, class A/B ops, network egress NA), BigQuery (queries TB, storage GB), Cloud Run Jobs (vCPU-s, GiB-s), Google Sign-In (free), Vercel Hobby (bandwidth GB, function invocations, function GB-hours/CPU-hours, edge requests; Pro price for the upgrade line), Neon Free (storage GB, compute CU-hours, data transfer GB), Ably Free (messages/month, peak connections, peak channels), New Relic Free (ingest GB/month, full users), Apple Developer Program ($99/year, always billable). The implementing agent MUST verify current numbers on the official pricing pages (WebFetch/WebSearch) and record `as_of` (YYYY-MM-DD) per entry; where a number cannot be verified, mark `"verified": false`.
- `usage.ts` — measured usage for a window from: `api_usage` (requests → Vercel invocations, bytes_out → bandwidth, duration → function time), `usage_events` (new table: `ts, kind, count, bytes`; recorded by routes for `signed_upload`, `signed_download`, `keyframe_registered`, `ably_publish`, `ably_token`, `bq_query`, `nr_push`, `gcs_list`), bucket stats (bytes/objects), `pg_database_size` (Neon storage), keyframe/point counts, Ably message estimate = keyframe publishes × (active participants + 1) + presence events, New Relic ingest ≈ metrics × 250 B.
- `engine.ts` — `estimate(usage, pricing) → CostReport`: per provider `{ provider, items: [{ metric, quantity, unit, free_quota, billable_quantity, unit_price_usd, cost_usd, source, as_of, verified }], total_usd, free_tier: { used_pct_max, first_exhausted_metric?, days_until_paid_at_current_rate? } }`, plus `actual: { gcp: from BigQuery export when configured }`, `grand_total_usd`, `monthly_run_rate_usd`.
- `projection.ts` — `project(params)` with params `{ mappers, sessions_per_day, minutes_per_session, keyframes_per_second (default 3), depth_bytes_per_keyframe (default 55_000), jpeg_every_n (0 = none), viewers_per_session, map_size_mb, maps_per_day, retention_days, dashboard_views_per_day }` → monthly quantities per metric → same `CostReport` shape plus `assumptions[]`.
- Endpoints (admin): `GET /admin/costs/overview?days=30`, `GET /admin/costs/projection?<params>`, `GET /admin/costs/pricing`, `GET /admin/costs/usage?days=30`. Keep the existing `/admin/costs` (BigQuery rows). `/admin/newrelic/push` also sends `ghostmap.cost.estimated_monthly_usd` per provider and `ghostmap.free_tier.used_pct` per metric.

## 4. Dashboard (ghostmap-dashboard)

- Env: `VITE_API_BASE` (default https://ghostmap-backend.vercel.app), `VITE_GOOGLE_CLIENT_ID`.
- Auth storage: `localStorage["ghostmap.auth"]` = `{ kind: "admin"|"user", token, user?, expires_at? }`.
- Routes: `/login` (Google Identity Services button + admin-key form), `/` maps library (cards: thumbnail, name, points, keyframes, duration, size, status, owner), `/maps/:id` (three.js PLY viewer with orbit/pan/zoom, stats, download PLY, rename/delete when allowed), `/parties` (list + create + "join with code"), `/parties/:id` (live view: participants panel with presence dots and colors, 3D scene with per-device point clouds from `keyframes.points_inline`, trajectories, live frustums from `pose` messages, keyframe counters, copy share link, leave, end), `/join/:code` (shows party summary → join as viewer; redirects to login first), `/admin` (health + free-tier gauges + actual vs estimated), `/admin/costs` (overview charts by provider/day/service, pricing table with sources, projection calculator with sliders that calls `/admin/costs/projection`), `/admin/network`, `/admin/storage`, `/settings`.
- Live viewer performance: one `BufferGeometry` per device, capacity grows in chunks (no per-message reallocation), points colored by device color with per-point RGB blended, decimate if > 2 M points total; catch-up via `GET /v1/sessions/:id/keyframes?since_id=…` then Ably subscribe (use `rewind` if available).
- E2E (Playwright, `E2E_BASE_URL`, `E2E_ADMIN_API_KEY`, `E2E_CLIENT_ACCESS_KEY`): login with admin key → create party → run `scripts/simulate-device.ts` (node) that mints a device token (legacy client key), joins by code, uploads two synthetic keyframes with inline points → assert points and participant appear in the live view; admin cost pages render numbers; maps list renders.
- `vercel.json` `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`; README with Vercel + Google OAuth setup.

## 5. iOS (apple-VSLAM-client, branch dev → feature branches)

- **Account:** Settings screen with backend URL (default the production URL), "Sign in with Google" via `ASWebAuthenticationSession` + PKCE against Google OAuth (client id from Info.plist key `GhostmapGoogleClientID`, redirect `com.googleusercontent.apps.<id>:/oauthredirect`), exchange code → id_token at Google's token endpoint (no client secret for iOS clients), then `POST /v1/auth/google` with the device identity; Keychain storage; sign out.
- **Cloud upload:** after a map is saved (and on demand from the detail view): `POST /v1/maps` → upload each file via signed URL (resumable for cloud.ply/keyframes.bin, `URLSession` background-capable) → finalize. Progress in UI; map row shows a cloud badge.
- **Party:** create (shows code, share link, QR via CoreImage `CIQRCodeGenerator`), join by code or `ghostmap://join/<code>` URL scheme, participants list with colors/presence, leave/rejoin, end (owner). While recording in a party: stream every keyframe (batched signed URLs, depth+confidence LZFSE payloads identical to the log, `points_inline` = 2 000 confirmed points decimated by stride, `aligned` flag), publish `pose` at 10 Hz via Ably REST (`POST https://rest.ably.io/channels/<ch>/messages` with the token), subscribe via Ably SSE (`https://realtime.ably.io/sse?channels=<ch>&v=1.2&accessToken=…` using a streaming `URLSession` data task) and render peers' inline points in their party color in the main view and Ghost Map; peers' latest poses as small frustums.
- **Marker origin:** bundle `Marker/ghostmap-marker.png` (a generated high-contrast 20×20 cm pattern, also exported as a printable PDF in docs) as an `ARReferenceImage` (`physicalWidth` 0.20 m, configurable); `ARWorldTrackingConfiguration.detectionImages`; on `ARImageAnchor` detection set `worldFromOrigin = anchor.transform` (keep updating while tracked; log), show "Marker aligned" in the status strip; keyframes uploaded in a party use `pose = worldFromOrigin⁻¹ · camera.transform` and `aligned = true`; before detection `aligned = false`. Sessions created with `origin.type = "marker"`.
- **Tests:** unit tests (URLProtocol stubs) for the API client, PKCE, keyframe stream encoder, marker transform math; XCUITest target `RoomMapperUITests` covering launch → settings → party screens (no camera), runnable with `scripts/rm.sh test-ui` on the device.

## 6. End-to-end across all three
- Backend: vitest E2E suite against a live deployment (`E2E_BASE_URL`, `ADMIN_API_KEY`, `CLIENT_ACCESS_KEY`), covering auth, maps, parties (cap of 4, join/leave/rejoin, ended), keyframes + realtime token, admin costs; GitHub Actions workflow runs unit tests on push and E2E when secrets exist.
- Dashboard: Playwright as in §4 with the device simulator.
- iOS: XCUITests on device; the simulator cannot run ARKit, so capture flows are verified manually per TESTING.md.
