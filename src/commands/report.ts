import { googleCustomerId, metaAdAccount, resolveProfile } from '../core/config.js'
import { usd } from '../core/money.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { gaqlSearch } from '../platforms/google.js'
import { insights, sumAction } from '../platforms/meta.js'

const PRESETS: Record<string, { google: string; meta: string }> = {
  'last-7d': { google: 'LAST_7_DAYS', meta: 'last_7d' },
  'last-30d': { google: 'LAST_30_DAYS', meta: 'last_30d' },
  mtd: { google: 'THIS_MONTH', meta: 'this_month' },
}

interface ReportRow {
  platform: string
  campaign: string
  spendMicros: number
  impressions: number
  clicks: number
  conversions: number
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function runReport(preset: string | undefined, opts: { profile?: string; json?: boolean; csv?: boolean }): Promise<void> {
  const p = PRESETS[preset ?? 'last-7d']
  if (!p) throw new Error(`unknown preset — use one of: ${Object.keys(PRESETS).join(', ')}`)
  const rp = resolveProfile(opts.profile)
  const rows: ReportRow[] = []
  try {
    const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
      `SELECT campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date DURING ${p.google} AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC`)
    for (const r of res.rows) {
      rows.push({
        platform: 'google',
        campaign: String(r['campaign.name'] ?? ''),
        spendMicros: Number(r['metrics.costMicros'] ?? 0),
        impressions: Number(r['metrics.impressions'] ?? 0),
        clicks: Number(r['metrics.clicks'] ?? 0),
        conversions: Number(r['metrics.conversions'] ?? 0),
      })
    }
  } catch (e) {
    console.error(`adops: skipping google — ${errMsg(e)}`)
  }
  try {
    const data = await insights(metaAdAccount(rp.profile), {
      level: 'campaign', datePreset: p.meta, fields: ['campaign_name', 'spend', 'impressions', 'clicks', 'actions'],
    })
    for (const r of data) {
      rows.push({
        platform: 'meta',
        campaign: String(r.campaign_name ?? ''),
        spendMicros: Math.round(Number(r.spend ?? 0) * 1e6),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        conversions: sumAction(r, rp.profile.meta_conversion_action),
      })
    }
  } catch (e) {
    console.error(`adops: skipping meta — ${errMsg(e)}`)
  }
  if (!rows.length) throw new Error('no platform reachable — run `adops auth` and configure a profile')
  rows.sort((a, b) => b.spendMicros - a.spendMicros)
  const fmt = formatFromFlags(opts)
  if (fmt === 'json') {
    console.log(JSON.stringify(rows.map(r => ({
      platform: r.platform, campaign: r.campaign, spend_micros: r.spendMicros,
      impressions: r.impressions, clicks: r.clicks, conversions: r.conversions,
    })), null, 2))
    return
  }
  printTable({
    columns: ['platform', 'campaign', 'spend', 'impr', 'clicks', 'conv'],
    rows: rows.map(r => ({
      platform: r.platform, campaign: r.campaign, spend: usd(r.spendMicros),
      impr: r.impressions.toLocaleString('en-US'), clicks: r.clicks.toLocaleString('en-US'), conv: r.conversions,
    })),
  }, fmt)
}
