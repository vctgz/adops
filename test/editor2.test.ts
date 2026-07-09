import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractTopics } from '../src/commands/ads.js'
import { buildAdgroupStatusPlan } from '../src/commands/adgroups.js'
import { keywordsQuery, shortQs } from '../src/commands/keywords.js'
import { buildAdgroupNegativesPlan } from '../src/commands/negatives.js'
import { setFetchImpl } from '../src/core/http.js'
import { applyPlan } from '../src/core/plan.js'

const RP = { name: 'test', profile: { currency: 'USD', meta_conversion_action: 'purchase', google_customer_id: '1234567890' } as any }

let captured: Array<{ url: string; body: any }> = []
beforeEach(() => {
  process.env.ADOPS_HOME = mkdtempSync(join(tmpdir(), 'adops-editor2-'))
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

describe('ad group status editing', () => {
  it('routes to adGroups:mutate with status update', async () => {
    const plan = buildAdgroupStatusPlan(RP, ['11', '22'], 'PAUSED')
    expect(plan.summary).toBe('pause 2 ad group(s)')
    await applyPlan(plan, RP.profile, { validateOnly: false })
    expect(captured[1].url).toContain('/customers/1234567890/adGroups:mutate')
    expect(captured[1].body.operations[0].update.resourceName).toBe('customers/1234567890/adGroups/11')
    expect(captured[1].body.operations[0].update.status).toBe('PAUSED')
    expect(captured[1].body.operations[0].updateMask).toBe('status')
  })
})

describe('ad-group-level negatives', () => {
  it('creates negatives against adGroupCriteria with an adGroup + negative flag', async () => {
    const plan = buildAdgroupNegativesPlan(RP, '999', ['free stuff', 'cheap'], 'EXACT')
    expect(plan.summary).toContain('ad group 999')
    await applyPlan(plan, RP.profile, { validateOnly: false })
    expect(captured[1].url).toContain('/adGroupCriteria:mutate')
    const create = captured[1].body.operations[0].create
    expect(create.adGroup).toBe('customers/1234567890/adGroups/999')
    expect(create.negative).toBe(true)
    expect(create.keyword).toEqual({ text: 'free stuff', matchType: 'EXACT' })
  })
})

describe('keywordsQuery + shortQs', () => {
  it('adds quality_info fields only with --qs', () => {
    expect(keywordsQuery(undefined, false)).not.toContain('quality_info')
    const q = keywordsQuery('778', true)
    expect(q).toContain('ad_group_criterion.quality_info.quality_score')
    expect(q).toContain('ad_group.id = 778')
  })
  it('maps QS component enums to short labels', () => {
    expect(shortQs('ABOVE_AVERAGE')).toBe('above')
    expect(shortQs('AVERAGE')).toBe('avg')
    expect(shortQs('BELOW_AVERAGE')).toBe('below')
    expect(shortQs('UNKNOWN')).toBe('—')
    expect(shortQs(undefined)).toBe('—')
  })
})

describe('extractTopics', () => {
  it('pulls topic strings out of policy_topic_entries', () => {
    expect(extractTopics([{ topic: 'DESTINATION_NOT_WORKING', type: 'LIMITED' }, { topic: 'TRADEMARKS' }])).toEqual(['DESTINATION_NOT_WORKING', 'TRADEMARKS'])
  })
  it('is safe on missing/odd input', () => {
    expect(extractTopics(undefined)).toEqual([])
    expect(extractTopics('nope')).toEqual([])
  })
})
