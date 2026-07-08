import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setFetchImpl } from '../src/core/http.js'
import { graphGet, insights, sumAction } from '../src/platforms/meta.js'

let urls: string[] = []

beforeEach(() => {
  urls = []
  process.env.META_ACCESS_TOKEN = 'test-meta-token'
})
afterEach(() => {
  setFetchImpl(null)
  delete process.env.META_ACCESS_TOKEN
})

describe('graphGet', () => {
  it('follows paging.next cursors', async () => {
    setFetchImpl(async url => {
      urls.push(String(url))
      if (urls.length === 1) {
        return new Response(JSON.stringify({
          data: [{ campaign_name: 'A', spend: '10.00' }],
          paging: { next: 'https://graph.facebook.com/v23.0/act_1/insights?after=xyz&access_token=test-meta-token' },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: [{ campaign_name: 'B', spend: '5.00' }] }), { status: 200 })
    })
    const rows = await graphGet('act_1/insights', { level: 'campaign' })
    expect(rows.map(r => r.campaign_name)).toEqual(['A', 'B'])
    expect(urls).toHaveLength(2)
  })
})

describe('insights', () => {
  it('builds level/fields/time_range params', async () => {
    setFetchImpl(async url => {
      urls.push(String(url))
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    })
    await insights('act_42', { level: 'ad', fields: ['ad_id', 'ctr'], since: '2026-07-01', until: '2026-07-07' })
    const u = new URL(urls[0])
    expect(u.pathname).toContain('/act_42/insights')
    expect(u.searchParams.get('level')).toBe('ad')
    expect(u.searchParams.get('fields')).toBe('ad_id,ctr')
    expect(JSON.parse(u.searchParams.get('time_range')!)).toEqual({ since: '2026-07-01', until: '2026-07-07' })
    expect(u.searchParams.get('access_token')).toBe('test-meta-token')
  })
})

describe('sumAction', () => {
  it('picks the configured action_type from actions', () => {
    const row = { actions: [{ action_type: 'link_click', value: '50' }, { action_type: 'purchase', value: '7' }] }
    expect(sumAction(row, 'purchase')).toBe(7)
    expect(sumAction(row, 'lead')).toBe(0)
    expect(sumAction({}, 'purchase')).toBe(0)
  })
})
