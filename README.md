# Ghostmap dashboard

Web console for [Ghostmap](https://github.com/AngeloLandiza/ghostmap-backend): a library of
room maps captured by the iOS app, live collaborative mapping "parties", and an admin console
that shows health, traffic, storage and what every provider is about to charge.

Vite + React 18 + TypeScript (strict) · Tailwind · React Router v6 · TanStack Query v5 · zod ·
three.js via React Three Fiber · Ably · Recharts · Playwright.

The cross-repo contract is `docs/PLAN-PHASE2.md`; the backend's endpoints are documented in
`ghostmap-backend/docs/API.md`. Design notes live in `DECISIONS.md`.

## Quick start

```bash
npm install
cp .env.example .env          # optional: only VITE_GOOGLE_CLIENT_ID really needs setting
npm run dev                   # http://localhost:5173
```

The dashboard talks to `https://ghostmap-backend.vercel.app` out of the box. To point it
elsewhere, either set `VITE_API_BASE` or change the base URL on **/settings** at runtime
(stored per browser, no rebuild needed).

Sign in with a Google account, or paste the backend's `ADMIN_API_KEY` into the admin-key box
on `/login` to get the admin pages.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on :5173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | typecheck, then a production build into `dist/` |
| `npm run preview` | serve the built bundle |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright specs in `e2e/` |
| `npm run simulate` | Runs `scripts/simulate-device.ts` (see below) |

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `VITE_API_BASE` | no | Default backend URL. Falls back to the production deployment. Overridable at runtime on /settings. |
| `VITE_GOOGLE_CLIENT_ID` | for Google sign-in | Google Identity Services **web** client id. Without it, `/login` offers the admin key only. |

Only `VITE_`-prefixed variables reach the browser, and everything in `.env` is git-ignored.
No secret belongs in this repo: the admin key is typed in by the operator and kept in their
own browser's `localStorage`.

### Google OAuth setup

1. Google Cloud console → **APIs & Services → Credentials → Create credentials → OAuth client
   ID → Web application**.
2. Authorized JavaScript origins: `http://localhost:5173` and the Vercel domain(s).
   Google Identity Services uses the origin only; no redirect URI is needed for the button.
3. Put the resulting client id in `VITE_GOOGLE_CLIENT_ID`, and add the **same** id to the
   backend's `GOOGLE_CLIENT_IDS` (comma-separated with the iOS client id).
4. The browser gets an `id_token` from Google, posts it to `POST /v1/auth/google`, and stores
   the Ghostmap token it gets back.

## Parties

A **party** (PLAN section 2) is a collaborative mapping session: several phones and browsers
watch the same room fill in live. Creating one on `/parties` gets you an 8-character invite
code and a share link, `${origin}/join/<code>` — post that link or read out the code, and
anyone who opens it lands on `/join/:code` (signing in first if needed) to join as a
**viewer**. A phone joins as a **device** — a mapper — instead, streaming keyframes into the
party as it captures; `/parties/:id` renders every device's point cloud, trajectory and live
camera frustum as the keyframes arrive over Ably, tinted by that participant's colour from a
fixed 8-colour palette. A party caps out at `max_participants` **distinct accounts** (default
4, phones from the same account count once); the owner, the leading device, or an admin can
end it from that page.

## Scripts

`scripts/simulate-device.ts` plays the part of a phone in a party without one — handy for
trying out the live view, and what `e2e/full-flow.spec.ts` uses to put a real, moving keyframe
stream in front of its assertions. It mints a device token from a legacy client access key,
joins a party by its invite code, then a few times a second registers a keyframe with a pose
that orbits a stationary, six-colour test cube, until a time limit elapses — then leaves.

```bash
npm run simulate -- --api https://ghostmap-backend.vercel.app --client-key <CLIENT_ACCESS_KEY> --code ABCD2EFG
#                     --seconds 20 --rate 3 are the defaults
```

## Routes

| Path | Access | Contents |
|---|---|---|
| `/login` | public | Google button + admin-key form |
| `/` | signed in | Map library |
| `/maps/:id` | signed in | PLY viewer, stats, download, rename/delete |
| `/parties` | signed in | Party list, create, join with a code |
| `/parties/:id` | signed in | Live party: participants, point clouds, trajectories, frustums |
| `/join/:code` | signed in (redirects through `/login`) | Share-link landing page |
| `/admin` | admin | Health, free-tier gauges, actual vs estimated cost |
| `/admin/costs` | admin | Cost overview, pricing table with sources, projection calculator |
| `/admin/network` | admin | Requests, latency, errors, bytes |
| `/admin/storage` | admin | Bucket usage per prefix |
| `/settings` | public | API base URL override, account, sign out |

Admin routes are gated on evidence: the app probes `GET /admin/overview` with the stored
token and only shows the admin nav when it answers 2xx.

## Project layout

```
src/
  main.tsx                 providers: QueryClient, Router, AuthProvider
  App.tsx                  routes; every page is a lazy chunk
  components/
    AppLayout.tsx          top bar, mobile tab bar, Suspense boundary
    ProtectedRoute.tsx     sign-in and admin guards
    ui.tsx                 PageHeader, Card, StatTile, Badge, Empty/Error/Loading, PageStub
  lib/
    api/types.ts           zod schemas and TS types for every payload (the shared contract)
    api/client.ts          fetch wrapper, ApiError, the `api` namespace
    api/hooks.ts           TanStack Query hooks and query keys
    auth.tsx               AuthProvider, useAuth, GoogleSignInButton, AdminKeyForm
    config.ts              API base + stored auth, both in localStorage
    format.ts              bytes, durations, money, relative time, invite codes
  pages/                   one file per route
```

### Talking to the backend

```tsx
import { useMaps } from './lib/api/hooks'
import { isApiError } from './lib/api/client'

const { data, isPending, error } = useMaps({ limit: 24 })
if (isApiError(error) && error.isNotConfigured) { /* feature off on this backend */ }
```

Responses arrive normalized to `camelCase` whichever casing the backend used, and missing
optional fields fall back rather than throwing — the backend's Phase 2 endpoints are landing
alongside this UI. Request bodies keep the backend's `snake_case` field names.

## Deploying to Vercel

Framework preset **Vite**; build `npm run build`; output `dist`. `vercel.json` already
rewrites every path to `/index.html` so deep links like `/join/ABCD2345` work. Set
`VITE_API_BASE` and `VITE_GOOGLE_CLIENT_ID` as project environment variables, then add the
deployment's URL to the backend's `DASHBOARD_URL` so share links point back here.

## Tests

`npm test` runs the Vitest suite (`src/**/*.test.ts`), which covers the API client's error
mapping and its tolerance of unexpected payloads. `npm run test:e2e` runs the Playwright specs
in `e2e/` against a real backend — see `e2e/README.md` for the flow, the secrets it needs
(`E2E_API_BASE`, `E2E_ADMIN_API_KEY`, `E2E_CLIENT_ACCESS_KEY`, optionally `E2E_BASE_URL`), and
how to run `scripts/simulate-device.ts` by hand. The suite skips itself — it does not fail —
when those secrets are not set.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

- **check** — `npm run typecheck`, `npm run build` and `npm test`, always.
- **e2e** — `npm run test:e2e`, only when the repository has `E2E_API_BASE`,
  `E2E_ADMIN_API_KEY` and `E2E_CLIENT_ACCESS_KEY` set as **repository secrets** (Settings →
  Secrets and variables → Actions). Without them the job is skipped rather than failed, since
  it needs a real backend to test against; `E2E_BASE_URL` is optional there too — unset, the
  job builds the dashboard and serves it with `vite preview`.
