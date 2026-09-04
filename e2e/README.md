# End-to-end tests

Playwright specs go here (`*.spec.ts`), per PLAN-PHASE2 section 4:

1. sign in with the admin key (`E2E_ADMIN_API_KEY`)
2. create a party
3. run `scripts/simulate-device.ts`, which mints a device token with `E2E_CLIENT_ACCESS_KEY`,
   joins by code and uploads two synthetic keyframes with inline points
4. assert the points and the participant appear in the live view
5. assert the admin cost pages render numbers and the maps list renders

Run against a deployment with `E2E_BASE_URL=https://… npx playwright test`, or without it to
have Playwright start `npm run dev` first. Install browsers once with `npx playwright install`.
