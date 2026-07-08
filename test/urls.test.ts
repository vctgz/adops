import { afterEach, describe, expect, it } from 'vitest'
import { checkUrls } from '../src/commands/urls.js'
import { setFetchImpl } from '../src/core/http.js'

afterEach(() => setFetchImpl(null))

describe('checkUrls', () => {
  it('reports status, missing utm tags, and errors', async () => {
    setFetchImpl(async url => {
      const u = String(url)
      if (u.includes('broken')) return new Response('nope', { status: 404 })
      if (u.includes('down')) throw new Error('ECONNREFUSED')
      return new Response('ok', { status: 200 })
    })
    const results = await checkUrls([
      'https://a.example/?utm_source=google',
      'https://b.example/broken?utm_source=google',
      'https://c.example/no-tags',
      'https://d.example/down?utm_source=x',
    ])
    expect(results[0].issues).toEqual([])
    expect(results[1].issues).toEqual(['HTTP 404'])
    expect(results[2].issues).toEqual(['no utm tags'])
    expect(results[3].status).toBe('error')
    expect(results[3].issues[0]).toContain('ECONNREFUSED')
  })
})
