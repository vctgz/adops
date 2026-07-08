import { metaAdAccount, resolveProfile } from '../core/config.js'
import { usd } from '../core/money.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { insights, sumAction } from '../platforms/meta.js'

const PRESETS: Record<string, string> = {
  '7d': 'last_7d',
  '14d': 'last_14d',
  '30d': 'last_30d',
  month: 'this_month',
}

const NAME_FIELD: Record<string, string> = {
  account: 'account_name',
  campaign: 'campaign_name',
  adset: 'adset_name',
  ad: 'ad_name',
}

export async function runInsights(opts: {
  profile?: string; level?: string; last?: string; since?: string; until?: string; by?: string; json?: boolean; csv?: boolean
}): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const level = (opts.level ?? 'campaign') as 'account' | 'campaign' | 'adset' | 'ad'
  const nameField = NAME_FIELD[level]
  if (!nameField) throw new Error(`--level must be one of: ${Object.keys(NAME_FIELD).join(', ')}`)
  const preset = PRESETS[opts.last ?? '7d']
  if (!preset && !(opts.since && opts.until)) throw new Error(`--last must be one of: ${Object.keys(PRESETS).join(', ')} (or pass --since/--until)`)
  const data = await insights(metaAdAccount(rp.profile), {
    level,
    fields: [nameField, 'spend', 'impressions', 'clicks', 'actions'],
    datePreset: opts.since && opts.until ? undefined : preset,
    since: opts.since,
    until: opts.until,
    breakdowns: opts.by,
  })
  const breakdownCols = opts.by ? opts.by.split(',').map(s => s.trim()).filter(Boolean) : []
  const fmt = formatFromFlags(opts)
  if (fmt === 'json') {
    console.log(JSON.stringify(data, null, 2))
    return
  }
  printTable({
    columns: ['name', ...breakdownCols, 'spend', 'impr', 'clicks', 'conv'],
    rows: data.map((r: any) => ({
      name: String(r[nameField] ?? ''),
      ...Object.fromEntries(breakdownCols.map(b => [b, String(r[b] ?? '')])),
      spend: usd(Math.round(Number(r.spend ?? 0) * 1e6)),
      impr: Number(r.impressions ?? 0).toLocaleString('en-US'),
      clicks: Number(r.clicks ?? 0).toLocaleString('en-US'),
      conv: sumAction(r, rp.profile.meta_conversion_action),
    })),
  }, fmt)
}
