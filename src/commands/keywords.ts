import { googleCustomerId, resolveProfile, type ResolvedProfile } from '../core/config.js'
import { assertComposite, parseIds } from '../core/ids.js'
import { dollarsToMicros, usd } from '../core/money.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { applyPlan, createPlan, type MatchType, type Plan, type Status } from '../core/plan.js'
import { gaqlSearch } from '../platforms/google.js'

const MATCH_TYPES: MatchType[] = ['EXACT', 'PHRASE', 'BROAD']

export async function runKeywordsList(opts: { profile?: string; adgroup?: string; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const where = ["ad_group_criterion.status != 'REMOVED'", "segments.date DURING LAST_30_DAYS"]
  if (opts.adgroup) where.push(`ad_group.id = ${opts.adgroup}`)
  const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
    `SELECT ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.effective_cpc_bid_micros, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE ${where.join(' AND ')} ORDER BY metrics.cost_micros DESC`)
  const rows = res.rows.map(r => ({
    id: `${r['adGroup.id']}~${r['adGroupCriterion.criterionId']}`,
    keyword: String(r['adGroupCriterion.keyword.text'] ?? ''),
    match: String(r['adGroupCriterion.keyword.matchType'] ?? ''),
    status: String(r['adGroupCriterion.status'] ?? ''),
    bid: Number(r['adGroupCriterion.effectiveCpcBidMicros'] ?? 0),
    cost: Number(r['metrics.costMicros'] ?? 0),
    conv: Number(r['metrics.conversions'] ?? 0),
  }))
  const fmt = formatFromFlags(opts)
  if (fmt === 'json') {
    console.log(JSON.stringify(rows.map(r => ({ ...r, bid_micros: r.bid, cost_micros: r.cost })), null, 2))
    return
  }
  printTable({
    columns: ['id', 'keyword', 'match', 'status', 'bid', 'cost', 'conv'],
    rows: rows.map(r => ({ id: r.id, keyword: r.keyword, match: r.match, status: r.status, bid: usd(r.bid), cost: usd(r.cost), conv: r.conv })),
  }, fmt)
}

export function buildKeywordStatusPlan(rp: ResolvedProfile, ids: string[], status: Status): Plan {
  if (!ids.length) throw new Error('no keyword ids given — pass --id "adGroupId~criterionId" (see gads keywords list)')
  const customerId = googleCustomerId(rp.profile)
  const verb = status === 'PAUSED' ? 'pause' : 'enable'
  return createPlan({
    profile: rp.name, platform: 'google',
    summary: `${verb} ${ids.length} keyword(s)`,
    ops: ids.map(id => ({
      kind: 'google.keyword.set_status' as const,
      customerId, criterion: assertComposite(id), status,
      describe: `~ keyword ${id} → ${status}`,
    })),
  })
}

export function buildKeywordBidPlan(rp: ResolvedProfile, id: string, cpcUsd: string): Plan {
  const customerId = googleCustomerId(rp.profile)
  const cpcBidMicros = dollarsToMicros(cpcUsd)
  return createPlan({
    profile: rp.name, platform: 'google',
    summary: `set keyword ${id} bid → ${usd(cpcBidMicros)}`,
    ops: [{
      kind: 'google.keyword.update_bid' as const,
      customerId, criterion: assertComposite(id), cpcBidMicros,
      describe: `~ keyword ${id} cpc → ${usd(cpcBidMicros)}`,
    }],
  })
}

export function buildKeywordAddPlan(rp: ResolvedProfile, adGroupId: string, terms: string[], match: MatchType): Plan {
  if (!terms.length) throw new Error('no terms to add — pass --terms "running shoes, trail shoes"')
  const customerId = googleCustomerId(rp.profile)
  return createPlan({
    profile: rp.name, platform: 'google',
    summary: `add ${terms.length} ${match.toLowerCase()} keyword(s) → ad group ${adGroupId}`,
    ops: terms.map(t => ({
      kind: 'google.keyword.create' as const,
      customerId, adGroupId, text: t, matchType: match,
      describe: `+ keyword [${match}] "${t}" → ad group ${adGroupId}`,
    })),
  })
}

async function stageOrApply(plan: Plan, rp: ResolvedProfile, apply?: boolean): Promise<void> {
  console.log(`${plan.id}: ${plan.summary}`)
  if (apply) {
    const receipt = await applyPlan(plan, rp.profile, { validateOnly: false })
    console.log(`applied ${plan.ops.length} operation(s) · receipt ${receipt!.id} → ~/.adops/log.jsonl`)
    return
  }
  console.log(`nothing applied · review: adops plan show ${plan.id} · execute: adops apply ${plan.id}`)
}

export async function runKeywordsStatus(action: 'pause' | 'enable', opts: { profile?: string; id?: string; apply?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  await stageOrApply(buildKeywordStatusPlan(rp, parseIds(opts.id), action === 'pause' ? 'PAUSED' : 'ENABLED'), rp, opts.apply)
}

export async function runKeywordsBid(opts: { profile?: string; id?: string; cpc?: string; apply?: boolean }): Promise<void> {
  if (!opts.id || !opts.cpc) throw new Error('usage: adops gads keywords bid --id <adGroupId~criterionId> --cpc <usd> [--apply]')
  const rp = resolveProfile(opts.profile)
  await stageOrApply(buildKeywordBidPlan(rp, opts.id, opts.cpc), rp, opts.apply)
}

export async function runKeywordsAdd(opts: { profile?: string; adgroup?: string; terms?: string; match?: string; apply?: boolean }): Promise<void> {
  if (!opts.adgroup) throw new Error('--adgroup <id> is required')
  const match = (opts.match ?? 'broad').toUpperCase() as MatchType
  if (!MATCH_TYPES.includes(match)) throw new Error(`--match must be one of: ${MATCH_TYPES.join(', ').toLowerCase()}`)
  const rp = resolveProfile(opts.profile)
  const terms = (opts.terms ?? '').split(',').map(s => s.trim()).filter(Boolean)
  await stageOrApply(buildKeywordAddPlan(rp, opts.adgroup, terms, match), rp, opts.apply)
}
