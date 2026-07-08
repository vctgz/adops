import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildNegativesPlan } from '../src/commands/negatives.js'
import { setFetchImpl } from '../src/core/http.js'
import { applyPlan, createPlan, listPlans, loadPlan, readReceipts } from '../src/core/plan.js'

const PROFILE = { currency: 'USD', meta_conversion_action: 'purchase', google_customer_id: '1234567890' }
const RP = { name: 'test', profile: PROFILE as any }

let home = ''
let captured: Array<{ url: string; body: any }> = []

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'adops-test-'))
  process.env.ADOPS_HOME = home
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

describe('plan lifecycle', () => {
  it('writes plan files that load and list back', () => {
    const plan = buildNegativesPlan(RP, '456', ['free ads course', 'ads jobs'], 'EXACT')
    expect(existsSync(join(home, 'plans', `${plan.id}.json`))).toBe(true)
    expect(loadPlan(plan.id).ops).toHaveLength(2)
    expect(loadPlan(plan.id.replace('plan-', '')).id).toBe(plan.id) // prefix optional
    expect(listPlans().map(p => p.id)).toContain(plan.id)
  })

  it('validate-only runs the native dry-run once and leaves no receipt', async () => {
    const plan = buildNegativesPlan(RP, '456', ['waste term'], 'EXACT')
    const receipt = await applyPlan(plan, PROFILE as any, { validateOnly: true })
    expect(receipt).toBeNull()
    expect(captured).toHaveLength(1)
    expect(captured[0].url).toContain('/customers/1234567890/campaignCriteria:mutate')
    expect(captured[0].body.validateOnly).toBe(true)
    expect(captured[0].body.operations[0].create.negative).toBe(true)
    expect(captured[0].body.operations[0].create.keyword).toEqual({ text: 'waste term', matchType: 'EXACT' })
    expect(readReceipts()).toHaveLength(0)
  })

  it('real apply dry-runs first, then applies, then writes a receipt', async () => {
    const plan = buildNegativesPlan(RP, '456', ['a', 'b'], 'PHRASE')
    const receipt = await applyPlan(plan, PROFILE as any, { validateOnly: false })
    expect(captured).toHaveLength(2)
    expect(captured[0].body.validateOnly).toBe(true)
    expect(captured[1].body.validateOnly).toBe(false)
    expect(receipt?.opCount).toBe(2)
    const receipts = readReceipts()
    expect(receipts).toHaveLength(1)
    expect(receipts[0].planId).toBe(plan.id)
    expect(readFileSync(join(home, 'log.jsonl'), 'utf8')).toContain(plan.id)
  })

  it('applies budget-update ops through campaignBudgets:mutate', async () => {
    const plan = createPlan({
      profile: 'test',
      platform: 'google',
      summary: 'set budget',
      ops: [{ kind: 'google.campaign_budget.update', customerId: '1234567890', budgetId: '789', amountMicros: 25_000_000, describe: '~ budget 789 → $25.00' }],
    })
    await applyPlan(plan, PROFILE as any, { validateOnly: false })
    expect(captured).toHaveLength(2)
    expect(captured[1].url).toContain('/campaignBudgets:mutate')
    expect(captured[1].body.operations[0].update.amountMicros).toBe('25000000')
    expect(captured[1].body.operations[0].update.resourceName).toBe('customers/1234567890/campaignBudgets/789')
  })

  it('refuses plans with unknown op kinds', async () => {
    const plan = createPlan({ profile: 'test', platform: 'google', summary: 'x', ops: [{ kind: 'meta.future.op' } as any] })
    await expect(applyPlan(plan, PROFILE as any, { validateOnly: true })).rejects.toThrowError(/cannot apply/)
  })
})
