/**
 * End-to-end flow (PLAN section 4 / `e2e/README.md`): admin sign-in, the maps library, a live
 * party fed by `scripts/simulate-device.ts`, and the four admin pages, run against a real
 * deployment named by `E2E_API_BASE`.
 *
 * Skipped entirely when the backend secrets are not set, so `npm run test:e2e` stays green on
 * a machine that only has the dashboard checked out.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const API_BASE = process.env.E2E_API_BASE
const ADMIN_KEY = process.env.E2E_ADMIN_API_KEY
const CLIENT_KEY = process.env.E2E_CLIENT_ACCESS_KEY

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SIM_SECONDS = 20
const SIM_RATE = 3

test.skip(
  !API_BASE || !ADMIN_KEY || !CLIENT_KEY,
  'Set E2E_API_BASE, E2E_ADMIN_API_KEY and E2E_CLIENT_ACCESS_KEY to run this suite against a live backend.',
)

/** Point the dashboard at the backend under test, in this browser context only. */
async function useTestBackend(page: Page): Promise<void> {
  await page.addInitScript((apiBase) => {
    try {
      window.localStorage.setItem('ghostmap.apiBase', apiBase)
    } catch {
      /* storage disabled; the test will just talk to the default backend and likely fail loudly */
    }
  }, API_BASE!)
}

async function signInWithAdminKey(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Admin key').fill(ADMIN_KEY!)
  await page.getByRole('button', { name: /continue with admin key/i }).click()
  // Successful sign-in redirects away from /login (to "/" by default).
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 })
}

/** Reads one `stat-<id>` counter from the live party stats bar as a number. */
async function readCounter(page: Page, id: string): Promise<number> {
  const text = await page.locator(`[data-testid="stat-${id}"] p`).innerText()
  return Number(text.replace(/[^\d.-]/g, '')) || 0
}

/** Spawns the device simulator against the party `code` and streams its log lines to stdout. */
function spawnSimulator(code: string): ChildProcessWithoutNullStreams {
  const child = spawn(
    'npx',
    [
      'tsx',
      'scripts/simulate-device.ts',
      '--api',
      API_BASE!,
      '--client-key',
      CLIENT_KEY!,
      '--code',
      code,
      '--seconds',
      String(SIM_SECONDS),
      '--rate',
      String(SIM_RATE),
    ],
    { cwd: REPO_ROOT, env: process.env },
  )
  const tag = (stream: 'out' | 'err') => (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) console.log(`[simulate-device:${stream}] ${line}`)
    }
  }
  child.stdout.on('data', tag('out'))
  child.stderr.on('data', tag('err'))
  return child
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('simulate-device did not exit in time')), timeoutMs)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

/** Asserts a `/admin*` page reached a loaded state with at least one real stat rendered. */
async function assertAdminPageRendersNumbers(page: Page, path: string, heading: RegExp): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
  // Every admin page in PLAN section 4 is built from `StatTile`s (`.card p.tabular-nums`); at
  // least one has to appear once its query resolves, whatever the numbers turn out to be.
  await expect(page.locator('.card p.tabular-nums').first()).toBeVisible({ timeout: 20_000 })
}

test.describe.configure({ mode: 'serial' })

test('admin console: sign in, a live party fed by a simulated device, and the admin pages', async ({ page }) => {
  test.setTimeout(150_000)

  let simulator: ChildProcessWithoutNullStreams | null = null

  await test.step('point the dashboard at the test backend', () => useTestBackend(page))

  await test.step('sign in with the admin key', () => signInWithAdminKey(page))

  await test.step('the maps library renders', async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Maps' })).toBeVisible()
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
    // Either the empty state or at least one card means the list loaded without erroring.
    await expect(page.getByText(/No maps|loaded ·/).or(page.locator('ul li').first())).toBeVisible({ timeout: 15_000 })
  })

  let partyId = ''
  let inviteCode = ''

  await test.step('create a party', async () => {
    await page.goto('/parties')
    // The empty state repeats the "New party" button, so there may be two matches.
    await page.getByRole('button', { name: 'New party' }).first().click()
    await page.getByLabel('Name').fill(`E2E ${new Date().toISOString()}`)
    await page.getByRole('button', { name: 'Create party' }).click()
    await page.waitForURL(/\/parties\/[^/]+$/, { timeout: 20_000 })
    partyId = page.url().split('/parties/')[1] ?? ''
    expect(partyId).not.toBe('')

    const codeEl = page.locator('code.font-mono.text-xs.tracking-wider')
    await expect(codeEl).toBeVisible({ timeout: 15_000 })
    inviteCode = (await codeEl.innerText()).replace(/[^A-Z2-7]/gi, '').toUpperCase()
    expect(inviteCode).toHaveLength(8)
  })

  try {
    await test.step('start the simulated device', () => {
      simulator = spawnSimulator(inviteCode)
    })

    await test.step('a participant row appears live', async () => {
      await expect(
        page.locator('[data-testid="participant-row"][data-participant-kind="device"]').first(),
      ).toBeVisible({ timeout: 30_000 })
    })

    await test.step('the keyframe counter grows', async () => {
      await expect
        .poll(() => readCounter(page, 'keyframes'), { timeout: 30_000, message: 'keyframe counter never left zero' })
        .toBeGreaterThan(0)
      const first = await readCounter(page, 'keyframes')
      await expect
        .poll(() => readCounter(page, 'keyframes'), { timeout: 20_000, message: 'keyframe counter did not grow' })
        .toBeGreaterThan(first)
    })

    await test.step('the simulator leaves at the end of its run', async () => {
      const remaining = simulator ? Math.max(5_000, SIM_SECONDS * 1000) : 0
      const code = await waitForExit(simulator!, remaining + 20_000)
      expect(code).toBe(0)
      simulator = null
      await expect(
        page.locator('[data-testid="participant-row"][data-participant-kind="device"]').first(),
      ).toHaveAttribute('data-left', 'true', { timeout: 20_000 })
    })
  } finally {
    // Belt and suspenders: never leave a stray simulator running if an assertion above threw.
    if (simulator) (simulator as ChildProcessWithoutNullStreams).kill('SIGTERM')
  }

  await test.step('admin pages render numbers', async () => {
    await assertAdminPageRendersNumbers(page, '/admin', /^admin$/i)
    await assertAdminPageRendersNumbers(page, '/admin/costs', /^costs$/i)
    await assertAdminPageRendersNumbers(page, '/admin/network', /^network$/i)
    await assertAdminPageRendersNumbers(page, '/admin/storage', /^storage$/i)
  })

  await test.step('sign out', async () => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  })
})
