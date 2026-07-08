import { googleCustomerId, metaAdAccount, resolveProfile } from '../core/config.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { gaqlSearch } from '../platforms/google.js'
import { campaigns as metaCampaigns, insights } from '../platforms/meta.js'

export interface Finding {
  check: string
  platform: string
  entity: string
  detail: string
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function runAudit(opts: { profile?: string; strict?: boolean; json?: boolean; csv?: boolean }): Promise<number> {
  const rp = resolveProfile(opts.profile)
  const findings: Finding[] = []
  const skipped: string[] = []

  // -- google checks -------------------------------------------------------
  try {
    const cid = googleCustomerId(rp.profile)

    const disapproved = await gaqlSearch(rp.profile, cid,
      `SELECT campaign.name, ad_group_ad.ad.id FROM ad_group_ad WHERE ad_group_ad.policy_summary.approval_status = 'DISAPPROVED' AND campaign.status = 'ENABLED'`)
    const byCampaign = new Map<string, number>()
    for (const r of disapproved.rows) {
      const name = String(r['campaign.name'] ?? '?')
      byCampaign.set(name, (byCampaign.get(name) ?? 0) + 1)
    }
    for (const [name, n] of byCampaign) {
      findings.push({ check: 'disapproved-ads', platform: 'google', entity: name, detail: `${n} disapproved ad(s)` })
    }

    const capped = await gaqlSearch(rp.profile, cid,
      `SELECT campaign.name, metrics.search_budget_lost_impression_share FROM campaign WHERE segments.date DURING LAST_7_DAYS AND campaign.status = 'ENABLED'`)
    for (const r of capped.rows) {
      const lost = Number(r['metrics.searchBudgetLostImpressionShare'] ?? 0)
      if (lost > 0.05) {
        findings.push({ check: 'budget-capped', platform: 'google', entity: String(r['campaign.name'] ?? '?'), detail: `losing ${Math.round(lost * 100)}% of search impressions to budget` })
      }
    }

    const zero = await gaqlSearch(rp.profile, cid,
      `SELECT campaign.name, metrics.impressions FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status = 'ENABLED'`)
    for (const r of zero.rows) {
      if (Number(r['metrics.impressions'] ?? 0) === 0) {
        findings.push({ check: 'zero-impressions', platform: 'google', entity: String(r['campaign.name'] ?? '?'), detail: 'enabled but no impressions in 30d' })
      }
    }
  } catch (e) {
    skipped.push(`google checks — ${errMsg(e)}`)
  }

  // -- meta checks ---------------------------------------------------------
  try {
    const acct = metaAdAccount(rp.profile)
    const active = (await metaCampaigns(acct)).filter((c: any) => c.effective_status === 'ACTIVE')
    const spent = await insights(acct, { level: 'campaign', datePreset: 'last_7d', fields: ['campaign_id', 'spend'] })
    const spentIds = new Set(spent.filter((r: any) => Number(r.spend ?? 0) > 0).map((r: any) => String(r.campaign_id)))
    for (const c of active) {
      if (!spentIds.has(String(c.id))) {
        findings.push({ check: 'active-no-spend', platform: 'meta', entity: String(c.name ?? c.id), detail: 'active but spent $0 in 7d' })
      }
    }
  } catch (e) {
    skipped.push(`meta checks — ${errMsg(e)}`)
  }

  for (const s of skipped) console.error(`adops: skipped ${s}`)
  if (!findings.length) {
    console.log(`audit clean${skipped.length ? ` (${skipped.length} check group(s) skipped)` : ''}`)
    return 0
  }
  printTable({
    columns: ['check', 'platform', 'entity', 'detail'],
    rows: findings.map(f => ({ ...f })),
  }, formatFromFlags(opts))
  console.log(`${findings.length} finding(s)`)
  return opts.strict ? 2 : 0
}
