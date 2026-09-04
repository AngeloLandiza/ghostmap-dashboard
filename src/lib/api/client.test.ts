/**
 * The API client's contract with the backend's error envelope
 * (`{ "error": { "code", "message", "details?" } }`) and its tolerance for payloads that do
 * not match the schemas yet — the two behaviours every page depends on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiError, api, codeForStatus, isApiError, request, toQueryString } from './client'
import { AUTH_STORAGE_KEY } from '../config'

const BASE = 'http://api.test'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('error mapping', () => {
  it('maps the documented error envelope onto ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'session_full', message: 'this party is full', details: { max: 4 } } }, 409),
    )

    const error = await request('/v1/sessions/join', { method: 'POST', baseUrl: BASE, token: null }).catch(
      (e: unknown) => e,
    )

    expect(isApiError(error)).toBe(true)
    const apiError = error as ApiError
    expect(apiError.code).toBe('session_full')
    expect(apiError.message).toBe('this party is full')
    expect(apiError.status).toBe(409)
    expect(apiError.details).toEqual({ max: 4 })
    expect(apiError.isAuthError).toBe(false)
  })

  it('flags 401 as an auth error and 403 as forbidden', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'unauthorized', message: 'no token' } }, 401))
    const unauthorized = (await request('/admin/overview', { baseUrl: BASE, token: null }).catch(
      (e: unknown) => e,
    )) as ApiError
    expect(unauthorized.isAuthError).toBe(true)

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'forbidden', message: 'admins only' } }, 403))
    const forbidden = (await request('/admin/overview', { baseUrl: BASE, token: null }).catch(
      (e: unknown) => e,
    )) as ApiError
    expect(forbidden.isForbidden).toBe(true)
    expect(forbidden.isAuthError).toBe(false)
  })

  it('derives a code from the status when the body is not an envelope', async () => {
    fetchMock.mockResolvedValue(new Response('upstream exploded', { status: 502 }))

    const error = (await request('/admin/costs', { baseUrl: BASE, token: null }).catch((e: unknown) => e)) as ApiError

    expect(error.code).toBe('upstream_error')
    expect(error.status).toBe(502)
    expect(error.message).toContain('upstream exploded')
  })

  it('keeps a 501 recognizable as "not configured"', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'not_configured', message: 'no BigQuery' } }, 501))
    const error = (await api.admin.billingCosts(30).catch((e: unknown) => e)) as ApiError
    expect(error.isNotConfigured).toBe(true)
  })

  it('wraps transport failures as network_error with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = (await request('/health', { baseUrl: BASE, token: null }).catch((e: unknown) => e)) as ApiError

    expect(error.code).toBe('network_error')
    expect(error.status).toBe(0)
    expect(error.isNetworkError).toBe(true)
    expect(error.message).toContain(BASE)
  })

  it('does not swallow aborts', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    const error = await request('/health', { baseUrl: BASE, token: null }).catch((e: unknown) => e)
    expect(isApiError(error)).toBe(false)
    expect((error as DOMException).name).toBe('AbortError')
  })

  it('rejects a 200 that is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<!doctype html><title>proxy</title>', { status: 200 }))
    const error = (await request('/health', { baseUrl: BASE, token: null }).catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('invalid_response')
  })

  it('maps every documented status even without a body', () => {
    expect(codeForStatus(400)).toBe('bad_request')
    expect(codeForStatus(404)).toBe('not_found')
    expect(codeForStatus(409)).toBe('conflict')
    expect(codeForStatus(410)).toBe('session_ended')
    expect(codeForStatus(500)).toBe('internal')
  })
})

describe('tolerance', () => {
  it('returns the raw payload when the response does not match its schema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }))

    const data = await request('/health', {
      baseUrl: BASE,
      token: null,
      schema: z.object({ ok: z.boolean() }),
    })

    expect(data).toEqual({ unexpected: true })
    expect(warn).toHaveBeenCalled()
  })

  it('accepts snake_case or camelCase for the same field', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ maps: [{ id: 'm1', point_count: '42', sizeBytes: 1000 }] }))
    const { maps } = await api.maps.list()
    expect(maps[0]?.pointCount).toBe(42)
    expect(maps[0]?.sizeBytes).toBe(1000)
    // Missing optional fields fall back instead of throwing.
    expect(maps[0]?.name).toBe('')
    expect(maps[0]?.files).toEqual([])
  })
})

describe('requests', () => {
  it('sends the stored bearer token, and none when token is null', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ kind: 'admin', token: 'secret-key' }))
    // A Response body can only be read once, so hand out a fresh one per call.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })))

    await request('/admin/overview', { baseUrl: BASE })
    const withAuth = (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit
    expect((withAuth.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')

    await request('/health', { baseUrl: BASE, token: null })
    const withoutAuth = (fetchMock.mock.calls[1]?.[1] ?? {}) as RequestInit
    expect((withoutAuth.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('drops empty query parameters', () => {
    expect(toQueryString({ days: 30, status: undefined, cursor: '', limit: 0 })).toBe('?days=30&limit=0')
    expect(toQueryString()).toBe('')
  })
})
