import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { adopsHome, type Profile } from './config.js'
import { mutate } from '../platforms/google.js'

export type Status = 'ENABLED' | 'PAUSED'
export type MatchType = 'EXACT' | 'PHRASE' | 'BROAD'

/**
 * Every op is one Google Ads mutate operation. Adding a new editable resource
 * = adding a variant here and a case in `opToMutation` below. Composite ids
 * (keywords, ads) are the `adGroupId~childId` form Google returns.
 */
export type PlanOp =
  | { kind: 'google.campaign_negative.create'; customerId: string; campaignId: string; text: string; matchType: MatchType; describe: string }
  | { kind: 'google.campaign_budget.update'; customerId: string; budgetId: string; amountMicros: number; describe: string }
  | { kind: 'google.campaign.set_status'; customerId: string; campaignId: string; status: Status; describe: string }
  | { kind: 'google.keyword.create'; customerId: string; adGroupId: string; text: string; matchType: MatchType; describe: string }
  | { kind: 'google.keyword.set_status'; customerId: string; criterion: string; status: Status; describe: string }
  | { kind: 'google.keyword.update_bid'; customerId: string; criterion: string; cpcBidMicros: number; describe: string }
  | { kind: 'google.ad.set_status'; customerId: string; adGroupAd: string; status: Status; describe: string }
  | { kind: 'google.ad_group.set_status'; customerId: string; adGroupId: string; status: Status; describe: string }
  | { kind: 'google.ad_group_negative.create'; customerId: string; adGroupId: string; text: string; matchType: MatchType; describe: string }

interface Mutation { customerId: string; resource: string; operation: Record<string, unknown> }

const rn = (customerId: string, resource: string, id: string) => `customers/${customerId}/${resource}/${id}`

/** Map a plan op to (resource, mutate-operation). The single source of truth for what's applyable. */
function opToMutation(op: PlanOp): Mutation {
  switch (op.kind) {
    case 'google.campaign_negative.create':
      return { customerId: op.customerId, resource: 'campaignCriteria', operation: {
        create: { campaign: rn(op.customerId, 'campaigns', op.campaignId), negative: true, keyword: { text: op.text, matchType: op.matchType } },
      } }
    case 'google.campaign_budget.update':
      return { customerId: op.customerId, resource: 'campaignBudgets', operation: {
        update: { resourceName: rn(op.customerId, 'campaignBudgets', op.budgetId), amountMicros: String(op.amountMicros) }, updateMask: 'amount_micros',
      } }
    case 'google.campaign.set_status':
      return { customerId: op.customerId, resource: 'campaigns', operation: {
        update: { resourceName: rn(op.customerId, 'campaigns', op.campaignId), status: op.status }, updateMask: 'status',
      } }
    case 'google.keyword.create':
      return { customerId: op.customerId, resource: 'adGroupCriteria', operation: {
        create: { adGroup: rn(op.customerId, 'adGroups', op.adGroupId), status: 'ENABLED', keyword: { text: op.text, matchType: op.matchType } },
      } }
    case 'google.keyword.set_status':
      return { customerId: op.customerId, resource: 'adGroupCriteria', operation: {
        update: { resourceName: rn(op.customerId, 'adGroupCriteria', op.criterion), status: op.status }, updateMask: 'status',
      } }
    case 'google.keyword.update_bid':
      return { customerId: op.customerId, resource: 'adGroupCriteria', operation: {
        update: { resourceName: rn(op.customerId, 'adGroupCriteria', op.criterion), cpcBidMicros: String(op.cpcBidMicros) }, updateMask: 'cpc_bid_micros',
      } }
    case 'google.ad.set_status':
      return { customerId: op.customerId, resource: 'adGroupAds', operation: {
        update: { resourceName: rn(op.customerId, 'adGroupAds', op.adGroupAd), status: op.status }, updateMask: 'status',
      } }
    case 'google.ad_group.set_status':
      return { customerId: op.customerId, resource: 'adGroups', operation: {
        update: { resourceName: rn(op.customerId, 'adGroups', op.adGroupId), status: op.status }, updateMask: 'status',
      } }
    case 'google.ad_group_negative.create':
      return { customerId: op.customerId, resource: 'adGroupCriteria', operation: {
        create: { adGroup: rn(op.customerId, 'adGroups', op.adGroupId), negative: true, keyword: { text: op.text, matchType: op.matchType } },
      } }
    default:
      throw new Error(`plan contains an op kind this version cannot apply: ${(op as PlanOp).kind}`)
  }
}

export interface Plan {
  id: string
  created: string
  profile: string
  platform: 'google' | 'meta'
  summary: string
  ops: PlanOp[]
}

export interface Receipt {
  id: string
  planId: string
  at: string
  opCount: number
  ops: string[]
}

const plansDir = () => join(adopsHome(), 'plans')
const logFile = () => join(adopsHome(), 'log.jsonl')

export function createPlan(p: Omit<Plan, 'id' | 'created'>): Plan {
  const plan: Plan = { id: `plan-${randomBytes(2).toString('hex')}`, created: new Date().toISOString(), ...p }
  mkdirSync(plansDir(), { recursive: true })
  writeFileSync(join(plansDir(), `${plan.id}.json`), JSON.stringify(plan, null, 2))
  return plan
}

export function loadPlan(id: string): Plan {
  const norm = id.startsWith('plan-') ? id : `plan-${id}`
  const file = join(plansDir(), `${norm}.json`)
  if (!existsSync(file)) throw new Error(`no such plan: ${norm} (in ${plansDir()})`)
  return JSON.parse(readFileSync(file, 'utf8')) as Plan
}

export function listPlans(): Plan[] {
  if (!existsSync(plansDir())) return []
  return readdirSync(plansDir())
    .filter(f => f.startsWith('plan-') && f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(plansDir(), f), 'utf8')) as Plan)
    .sort((a, b) => a.created.localeCompare(b.created))
}

export function readReceipts(): Receipt[] {
  if (!existsSync(logFile())) return []
  return readFileSync(logFile(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Receipt)
}

/**
 * The mutation lifecycle. Ops are grouped by (customer, resource) into batched
 * mutate calls. Always runs the platform's native dry-run first
 * (validateOnly: true); only then, if a real apply was requested, runs it for
 * real and appends a receipt. Validate-only runs leave no receipt — nothing changed.
 */
export async function applyPlan(plan: Plan, profile: Profile, opts: { validateOnly: boolean }): Promise<Receipt | null> {
  // opToMutation throws on unknown kinds here, before any network call.
  const groups = new Map<string, { customerId: string; resource: string; operations: Array<Record<string, unknown>> }>()
  for (const op of plan.ops) {
    const m = opToMutation(op)
    const key = `${m.customerId}::${m.resource}`
    const g = groups.get(key) ?? { customerId: m.customerId, resource: m.resource, operations: [] }
    g.operations.push(m.operation)
    groups.set(key, g)
  }

  const run = async (validateOnly: boolean) => {
    for (const g of groups.values()) {
      await mutate(profile, g.customerId, g.resource, g.operations, validateOnly)
    }
  }

  await run(true)
  if (opts.validateOnly) return null
  await run(false)

  const receipt: Receipt = {
    id: `r-${randomBytes(2).toString('hex')}`,
    planId: plan.id,
    at: new Date().toISOString(),
    opCount: plan.ops.length,
    ops: plan.ops.map(o => o.describe),
  }
  mkdirSync(adopsHome(), { recursive: true })
  appendFileSync(logFile(), JSON.stringify(receipt) + '\n')
  return receipt
}
