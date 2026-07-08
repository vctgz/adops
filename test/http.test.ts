import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HttpError, request, setFetchImpl } from '../src/core/http.js'

beforeEach(() => {
  process.env.ADOPS_RETRY_BASE_MS = '1'
})
afterEach(() => {
  setFetchImpl(null)
  delete process.env.ADOPS_RETRY_BASE_MS
})

describe('request', () => {
  it('retries 429 then succeeds', async () => {
    let calls = 0
    setFetchImpl(async () => {
      calls++
      return calls === 1
        ? new Response('slow down', { status: 429 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const res = await request('https://example.com/x')
    expect(calls).toBe(2)
    expect(res.body).toEqual({ ok: true })
  })

  it('throws HttpError with the API error message', async () => {
    setFetchImpl(async () => new Response(JSON.stringify({ error: { message: 'invalid GAQL' } }), { status: 400 }))
    await expect(request('https://example.com/x')).rejects.toThrowError('invalid GAQL')
    setFetchImpl(async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 400 }))
    await expect(request('https://example.com/x')).rejects.toBeInstanceOf(HttpError)
  })

  it('returns non-2xx when okOnly is false', async () => {
    setFetchImpl(async () => new Response('gone', { status: 404 }))
    const res = await request('https://example.com/x', {}, { okOnly: false, retries: 0 })
    expect(res.status).toBe(404)
  })

  it('gives up after retries and throws', async () => {
    let calls = 0
    setFetchImpl(async () => {
      calls++
      return new Response('boom', { status: 500 })
    })
    await expect(request('https://example.com/x', {}, { retries: 2 })).rejects.toBeInstanceOf(HttpError)
    expect(calls).toBe(3)
  })
})
