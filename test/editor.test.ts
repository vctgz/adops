import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildAdStatusPlan } from '../src/commands/ads.js'
import { buildCampaignStatusPlan } from '../src/commands/campaigns.js'
import { buildKeywordAddPlan, buildKeywordBidPlan, buildKeywordStatusPlan } from '../src/commands/keywords.js'
import { setFetchImpl } from '../src/core/http.js'
import { applyPlan } from '../src/core/plan.js'

const RP = { name: 'test', profile: { currency: 'USD', meta_conversion_action: 'purchase', google_customer_id: '1234567890' } as any }

let captured: Array<{ url: string; body: any }> = []

beforeEach(() => {
  process.env.ADOPS_HOME = mkdtempSync(join(tmpdir(), 'adops-editor-'))
  process.env.GOOGLE_ADS_ACCESS_TOKEN = 'tok'
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev'
  captured = []
  setFetchImpl(async (url, init) => {
    captured.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify({ results: [] }), { status: 200 })
  })
})
afterEach(() => {
  setFetchImpl(null)
  delete process.env.ADOPS_HOME
  delete process.env.GOOGLE_ADS_ACCESS_TOKEN
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
})

describe('campaign status editing', () => {
  it('pauses N campaigns via one batched campaigns:mutate', async () => {
    const plan = buildCampaignStatusPlan(RP, ['11', '22', '33'], 'PAUSED')
    expect(plan.summary).toBe('pause 3 campaign(s)')
    await applyPlan(plan, RP.profile, { validateOnly: false })
    // dry-run + real, each batching all 3 into one call
    expect(captured).toHaveLength(2)
    expect(captured[0].url).toContain('/customers/1234567890/campaigns:mutate')
    expect(captured[0].body.validateOnly).toBe(true)
    expect(captured[1].body.validateOnly).toBe(false)
    expect(captured[1].body.operations).toHaveLength(3)
    expect(captured[1].body.operations[0].update.status).toBe('PAUSED')
    expect(captured[1].body.operations[0].updateMask).toBe('status')
    expect(captured[1].body.operations[2].update.resourceName).toBe('customers/1234567890/campaigns/33')
  })
})

describe('keyword editing', () => {
  it('routes status changes to adGroupCriteria:mutate with composite resource names', async () => {
    const plan = buildKeywordStatusPlan(RP, ['123~456', '123~789'], 'ENABLED')
    await applyPlan(plan, RP.profile, { validateOnly: true })
    expect(captured).toHaveLength(1) // validate-only: one dry-run, no real call
    expect(captured[0].url).toContain('/adGroupCriteria:mutate')
    expect(captured[0].body.operations[0].update.resourceName).toBe('customers/1234567890/adGroupCriteria/123~456')
    expect(captured[0].body.operations[1].update.status).toBe('ENABLED')
  })

  it('stages a bid change as cpc_bid_micros', async () => {
    const plan = buildKeywordBidPlan(RP, '123~456', '1.75')
    await applyPlan(plan, RP.profile, { validateOnly: false })
    expect(captured[1].body.operations[0].update.cpcBidMicros).toBe('1750000')
    expect(captured[1].body.operations[0].updateMask).toBe('cpc_bid_micros')
  })

  it('creates positive keywords under an ad group', async () => {
    const plan = buildKeywordAddPlan(RP, '999', ['running shoes', 'trail shoes'], 'PHRASE')
    await applyPlan(plan, RP.profile, { validateOnly: false })
    const create = captured[1].body.operations[0].create
    expect(create.adGroup).toBe('customers/1234567890/adGroups/999')
    expect(create.keyword).toEqual({ text: 'running shoes', matchType: 'PHRASE' })
    expect(create.status).toBe('ENABLED')
  })

  it('rejects non-composite ids before hitting the network', () => {
    expect(() => buildKeywordStatusPlan(RP, ['456'], 'PAUSED')).toThrowError(/adGroupId~criterionId/)
    expect(captured).toHaveLength(0)
  })
})

describe('ad status editing', () => {
  it('routes to adGroupAds:mutate', async () => {
    const plan = buildAdStatusPlan(RP, ['123~555'], 'PAUSED')
    await applyPlan(plan, RP.profile, { validateOnly: false })
    expect(captured[1].url).toContain('/adGroupAds:mutate')
    expect(captured[1].body.operations[0].update.resourceName).toBe('customers/1234567890/adGroupAds/123~555')
  })
})

describe('mixed plan batching', () => {
  it('groups ops by resource — campaigns and keywords hit separate endpoints', async () => {
    // hand-assemble a plan spanning two resources by concatenating ops
    const a = buildCampaignStatusPlan(RP, ['11'], 'PAUSED')
    const b = buildKeywordStatusPlan(RP, ['1~2'], 'PAUSED')
    a.ops.push(...b.ops)
    await applyPlan(a, RP.profile, { validateOnly: true })
    const urls = captured.map(c => c.url)
    expect(urls.some(u => u.includes('/campaigns:mutate'))).toBe(true)
    expect(urls.some(u => u.includes('/adGroupCriteria:mutate'))).toBe(true)
    expect(captured).toHaveLength(2) // two resources, one dry-run each
  })
})
