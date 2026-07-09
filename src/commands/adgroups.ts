import { googleCustomerId, resolveProfile, type ResolvedProfile } from '../core/config.js'
import { parseIds } from '../core/ids.js'
import { usd } from '../core/money.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { applyPlan, createPlan, type Plan, type Status } from '../core/plan.js'
import { gaqlSearch } from '../platforms/google.js'

export async function runAdgroupsList(opts: { profile?: string; campaign?: string; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const where = ["ad_group.status != 'REMOVED'", 'segments.date DURING THIS_MONTH']
  if (opts.campaign) where.push(`campaign.id = ${opts.campaign}`)
  const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
    `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.name, metrics.cost_micros FROM ad_group WHERE ${where.join(' AND ')} ORDER BY metrics.cost_micros DESC`)
  const fmt = formatFromFlags(opts)
  if (fmt === 'json') {
    console.log(JSON.stringify(res.rows.map(r => ({
      id: r['adGroup.id'], name: r['adGroup.name'], status: r['adGroup.status'],
      campaign: r['campaign.name'], mtd_spend_micros: Number(r['metrics.costMicros'] ?? 0),
    })), null, 2))
    return
  }
  printTable({
    columns: ['id', 'name', 'status', 'campaign', 'mtd spend'],
    rows: res.rows.map(r => ({
      id: String(r['adGroup.id'] ?? ''),
      name: String(r['adGroup.name'] ?? ''),
      status: String(r['adGroup.status'] ?? ''),
      campaign: String(r['campaign.name'] ?? ''),
      'mtd spend': usd(Number(r['metrics.costMicros'] ?? 0), 0),
    })),
  }, fmt)
}

export function buildAdgroupStatusPlan(rp: ResolvedProfile, ids: string[], status: Status): Plan {
  if (!ids.length) throw new Error('no ad group ids given — pass --id "123,456" (see gads adgroups list)')
  const customerId = googleCustomerId(rp.profile)
  const verb = status === 'PAUSED' ? 'pause' : 'enable'
  return createPlan({
    profile: rp.name, platform: 'google',
    summary: `${verb} ${ids.length} ad group(s)`,
    ops: ids.map(id => ({
      kind: 'google.ad_group.set_status' as const,
      customerId, adGroupId: id, status,
      describe: `~ ad group ${id} → ${status}`,
    })),
  })
}

export async function runAdgroupsStatus(action: 'pause' | 'enable', opts: { profile?: string; id?: string; apply?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const plan = buildAdgroupStatusPlan(rp, parseIds(opts.id), action === 'pause' ? 'PAUSED' : 'ENABLED')
  console.log(`${plan.id}: ${plan.summary}`)
  if (opts.apply) {
    const receipt = await applyPlan(plan, rp.profile, { validateOnly: false })
    console.log(`applied ${plan.ops.length} operation(s) · receipt ${receipt!.id} → ~/.adops/log.jsonl`)
    return
  }
  console.log(`nothing applied · review: adops plan show ${plan.id} · execute: adops apply ${plan.id}`)
}
