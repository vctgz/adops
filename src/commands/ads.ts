import { googleCustomerId, resolveProfile, type ResolvedProfile } from '../core/config.js'
import { assertComposite, parseIds } from '../core/ids.js'
import { usd } from '../core/money.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { applyPlan, createPlan, type Plan, type Status } from '../core/plan.js'
import { gaqlSearch } from '../platforms/google.js'

/** Pull the human-readable policy topics out of a policy_topic_entries array. */
export function extractTopics(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((e: any) => e?.topic).filter((t: unknown): t is string => typeof t === 'string')
}

export async function runAdsList(opts: { profile?: string; disapproved?: boolean; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const fmt = formatFromFlags(opts)

  if (opts.disapproved) {
    const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
      `SELECT ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.type, campaign.name, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.policy_topic_entries FROM ad_group_ad WHERE ad_group_ad.policy_summary.approval_status = 'DISAPPROVED' AND ad_group_ad.status != 'REMOVED'`)
    const rows = res.rows.map(r => ({
      id: `${r['adGroup.id']}~${r['adGroupAd.ad.id']}`,
      type: String(r['adGroupAd.ad.type'] ?? ''),
      campaign: String(r['campaign.name'] ?? ''),
      reasons: extractTopics(r['adGroupAd.policySummary.policyTopicEntries']),
    }))
    if (fmt === 'json') {
      console.log(JSON.stringify(rows, null, 2))
      return
    }
    if (!rows.length) {
      console.log('no disapproved ads')
      return
    }
    printTable({
      columns: ['id', 'type', 'campaign', 'reasons'],
      rows: rows.map(r => ({ id: r.id, type: r.type, campaign: r.campaign, reasons: r.reasons.join(', ') || '—' })),
    }, fmt)
    return
  }

  const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
    `SELECT ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status, campaign.name, metrics.cost_micros FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND segments.date DURING LAST_30_DAYS ORDER BY metrics.cost_micros DESC`)
  const rows = res.rows.map(r => ({
    id: `${r['adGroup.id']}~${r['adGroupAd.ad.id']}`,
    type: String(r['adGroupAd.ad.type'] ?? ''),
    status: String(r['adGroupAd.status'] ?? ''),
    campaign: String(r['campaign.name'] ?? ''),
    cost: Number(r['metrics.costMicros'] ?? 0),
  }))
  if (fmt === 'json') {
    console.log(JSON.stringify(rows.map(r => ({ ...r, cost_micros: r.cost })), null, 2))
    return
  }
  printTable({
    columns: ['id', 'type', 'status', 'campaign', 'cost'],
    rows: rows.map(r => ({ id: r.id, type: r.type, status: r.status, campaign: r.campaign, cost: usd(r.cost) })),
  }, fmt)
}

export function buildAdStatusPlan(rp: ResolvedProfile, ids: string[], status: Status): Plan {
  if (!ids.length) throw new Error('no ad ids given — pass --id "adGroupId~adId" (see gads ads list)')
  const customerId = googleCustomerId(rp.profile)
  const verb = status === 'PAUSED' ? 'pause' : 'enable'
  return createPlan({
    profile: rp.name, platform: 'google',
    summary: `${verb} ${ids.length} ad(s)`,
    ops: ids.map(id => ({
      kind: 'google.ad.set_status' as const,
      customerId, adGroupAd: assertComposite(id), status,
      describe: `~ ad ${id} → ${status}`,
    })),
  })
}

export async function runAdsStatus(action: 'pause' | 'enable', opts: { profile?: string; id?: string; apply?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const plan = buildAdStatusPlan(rp, parseIds(opts.id), action === 'pause' ? 'PAUSED' : 'ENABLED')
  console.log(`${plan.id}: ${plan.summary}`)
  if (opts.apply) {
    const receipt = await applyPlan(plan, rp.profile, { validateOnly: false })
    console.log(`applied ${plan.ops.length} operation(s) · receipt ${receipt!.id} → ~/.adops/log.jsonl`)
    return
  }
  console.log(`nothing applied · review: adops plan show ${plan.id} · execute: adops apply ${plan.id}`)
}
