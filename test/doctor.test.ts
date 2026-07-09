import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDoctor } from '../src/commands/doctor.js'
import { setFetchImpl } from '../src/core/http.js'

let logs: string[] = []

beforeEach(() => {
  logs = []
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.join(' ')) })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.ADOPS_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'adops-doc-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  setFetchImpl(null)
  for (const k of ['ADOPS_CONFIG_DIR', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_ACCESS_TOKEN', 'GOOGLE_ADS_OAUTH_CLIENT_ID', 'GOOGLE_ADS_OAUTH_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID']) delete process.env[k]
})

describe('runDoctor', () => {
  it('fails (exit 1) and flags the developer token when nothing is configured', async () => {
    const code = await runDoctor({})
    expect(code).toBe(1)
    expect(logs.join('\n')).toContain('developer token')
    expect(logs.join('\n')).toMatch(/✗/)
  })

  it('passes (exit 0) when creds + API all respond', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev'
    process.env.GOOGLE_ADS_ACCESS_TOKEN = 'tok' // short-circuits token refresh
    process.env.GOOGLE_ADS_OAUTH_CLIENT_ID = 'id'
    process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET = 'secret'
    process.env.GOOGLE_ADS_REFRESH_TOKEN = 'refresh'
    process.env.GOOGLE_ADS_CUSTOMER_ID = '1234567890'
    setFetchImpl(async url => {
      const u = String(url)
      if (u.includes('listAccessibleCustomers')) return new Response(JSON.stringify({ resourceNames: ['customers/1234567890'] }), { status: 200 })
      if (u.includes('googleAds:searchStream')) return new Response(JSON.stringify([{ results: [{ customer: { id: '1234567890', descriptiveName: 'Acme' } }], fieldMask: 'customer.id,customer.descriptiveName' }]), { status: 200 })
      return new Response('{}', { status: 200 })
    })
    const code = await runDoctor({})
    expect(code).toBe(0)
    const out = logs.join('\n')
    expect(out).toContain('Acme')
    expect(out).toContain('all checks passed')
    expect(out).not.toMatch(/✗/)
  })
})
