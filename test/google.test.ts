import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setFetchImpl } from '../src/core/http.js'
import { gaqlSearch } from '../src/platforms/google.js'

const PROFILE = { currency: 'USD', meta_conversion_action: 'purchase' }

const STREAM_FIXTURE = [
  {
    results: [
      {
        searchTermView: { searchTerm: 'free ads course' },
        metrics: { costMicros: '412900000', clicks: '310', conversions: 0 },
      },
      {
        searchTermView: { searchTerm: 'ads jobs remote' },
        metrics: { costMicros: '268130000', clicks: '205', conversions: 0 },
      },
    ],
    fieldMask: 'searchTermView.searchTerm,metrics.costMicros,metrics.clicks,metrics.conversions',
  },
]

let captured: Array<{ url: string; headers: Record<string, string>; body: any }> = []

beforeEach(() => {
  captured = []
  process.env.GOOGLE_ADS_ACCESS_TOKEN = 'test-access-token'
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token'
  setFetchImpl(async (url, init) => {
    captured.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return new Response(JSON.stringify(STREAM_FIXTURE), { status: 200 })
  })
})
afterEach(() => {
  setFetchImpl(null)
  delete process.env.GOOGLE_ADS_ACCESS_TOKEN
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
})

describe('gaqlSearch', () => {
  it('flattens searchStream chunks to fieldMask dot-paths', async () => {
    const res = await gaqlSearch(PROFILE as any, '1234567890', 'SELECT ...')
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0]['searchTermView.searchTerm']).toBe('free ads course')
    expect(res.rows[0]['metrics.costMicros']).toBe('412900000')
    expect(res.fieldMask[0]).toBe('searchTermView.searchTerm')
  })

  it('sends developer token and bearer auth, hits searchStream', async () => {
    await gaqlSearch(PROFILE as any, '1234567890', 'SELECT ...')
    const req = captured[0]
    expect(req.url).toContain('/customers/1234567890/googleAds:searchStream')
    expect(req.headers['developer-token']).toBe('test-dev-token')
    expect(req.headers.authorization).toBe('Bearer test-access-token')
    expect(req.body.query).toBe('SELECT ...')
  })

  it('sends login-customer-id when the profile has an MCC', async () => {
    await gaqlSearch({ ...PROFILE, google_login_customer_id: '111-222-3333' } as any, '99', 'SELECT ...')
    expect(captured[0].headers['login-customer-id']).toBe('1112223333')
  })
})
