# End-to-end tests

Playwright specs (`*.spec.ts`), run against a real deployment — no mocking, per PLAN-PHASE2
section 4. The whole suite is skipped (not failed) when the required secrets are not set, so
`npm run test:e2e` stays green on a machine that only has this repo checked out.

## What `full-flow.spec.ts` does

1. Points this browser session at `E2E_API_BASE` (`localStorage["ghostmap.apiBase"]`).
2. Signs in on `/login` with `E2E_ADMIN_API_KEY`.
3. Confirms the maps library (`/`) renders — an empty state or cards, but no error.
4. Creates a party on `/parties`, lands on `/parties/:id`, and reads its invite code off the
   page.
5. Spawns `scripts/simulate-device.ts` as a child process (mints a device token from
   `E2E_CLIENT_ACCESS_KEY`, joins the party by that code, and streams a synthetic keyframe a
   few times a second for 20 seconds), and watches the live view:
   - a participant row for that device appears within 30 s,
   - the keyframe counter in the stats bar leaves zero and then keeps growing,
   - once the simulator's 20 seconds are up it leaves on its own, and the participant row
     flips to "left".
6. Visits `/admin`, `/admin/costs`, `/admin/network` and `/admin/storage` and checks each one
   rendered at least one real stat tile (not stuck loading, not an error).
7. Signs out from `/settings` and confirms the app redirects to `/login`.

## Running it

```bash
npx playwright install        # once, to fetch the browsers
E2E_API_BASE=https://ghostmap-backend.vercel.app \
E2E_ADMIN_API_KEY=... \
E2E_CLIENT_ACCESS_KEY=... \
npx playwright test           # or: npm run test:e2e
```

`E2E_BASE_URL` points at the dashboard itself; leave it unset and Playwright starts
`npm run dev` on `:5173` for you. Set it to test a Vercel preview deployment instead.

**The target backend needs Ably configured.** The live-party assertions depend on the
realtime `participant` and `keyframes` messages the backend publishes on join and on keyframe
registration (PLAN section 2) — without them the view only shows a one-time REST snapshot and
the counter never grows.

## Running the simulator by itself

Useful for exercising the live view by hand, against a party you created from the UI:

```bash
npm run simulate -- --api https://ghostmap-backend.vercel.app --client-key <CLIENT_ACCESS_KEY> --code ABCD2EFG
# --seconds 20 --rate 3 are the defaults; pass either to change how long/fast it streams.
```

It draws a stationary, six-colour test cube (one colour per face) and orbits a synthetic
camera pose around it, so a real run is unmistakable in the 3D viewer.
