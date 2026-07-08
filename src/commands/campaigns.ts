import { googleCustomerId, resolveProfile, type ResolvedProfile } from '../core/config.js'
import { parseIds } from '../core/ids.js'
import { usd } from '../core/money.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { applyPlan, createPlan, type Plan, type Status } from '../core/plan.js'
import { gaqlSearch } from '../platforms/google.js'

export async function runCampaignsList(opts: { profile?: string; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.id, metrics.cost_micros FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date DURING THIS_MONTH ORDER BY metrics.cost_micros DESC`)
  const fmt = formatFromFlags(opts)
  if (fmt === 'json') {
    console.log(JSON.stringify(res.rows.map(r => ({
      id: r['campaign.id'], name: r['campaign.name'], status: r['campaign.status'],
      channel: r['campaign.advertisingChannelType'], budget_id: r['campaignBudget.id'],
      mtd_spend_micros: Number(r['metrics.costMicros'] ?? 0),
    })), null, 2))
    return
  }
  printTable({
    columns: ['id', 'name', 'status', 'channel', 'budget id', 'mtd spend'],
    rows: res.rows.map(r => ({
      id: String(r['campaign.id'] ?? ''),
      name: String(r['campaign.name'] ?? ''),
      status: String(r['campaign.status'] ?? ''),
      channel: String(r['campaign.advertisingChannelType'] ?? ''),
      'budget id': String(r['campaignBudget.id'] ?? ''),
      'mtd spend': usd(Number(r['metrics.costMicros'] ?? 0), 0),
    })),
  }, fmt)
}

export function buildCampaignStatusPlan(rp: ResolvedProfile, ids: string[], status: Status): Plan {
  if (!ids.length) throw new Error('no campaign ids given — pass --id "123,456" (see gads campaigns list)')
  const customerId = googleCustomerId(rp.profile)
  const verb = status === 'PAUSED' ? 'pause' : 'enable'
  return createPlan({
    profile: rp.name,
    platform: 'google',
    summary: `${verb} ${ids.length} campaign(s)`,
    ops: ids.map(id => ({
      kind: 'google.campaign.set_status' as const,
      customerId, campaignId: id, status,
      describe: `~ campaign ${id} → ${status}`,
    })),
  })
}

export async function runCampaignsStatus(action: 'pause' | 'enable', opts: { profile?: string; id?: string; apply?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const plan = buildCampaignStatusPlan(rp, parseIds(opts.id), action === 'pause' ? 'PAUSED' : 'ENABLED')
  console.log(`${plan.id}: ${plan.summary}`)
  if (opts.apply) {
    const receipt = await applyPlan(plan, rp.profile, { validateOnly: false })
    console.log(`applied ${plan.ops.length} operation(s) · receipt ${receipt!.id} → ~/.adops/log.jsonl`)
    return
  }
  console.log(`nothing applied · review: adops plan show ${plan.id} · execute: adops apply ${plan.id}`)
}
