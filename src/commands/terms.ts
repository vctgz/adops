import { googleCustomerId, resolveProfile } from '../core/config.js'
import { usd } from '../core/money.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { gaqlSearch } from '../platforms/google.js'

export const TERMS_PRESETS: Record<string, string> = {
  '7d': 'LAST_7_DAYS',
  '14d': 'LAST_14_DAYS',
  '30d': 'LAST_30_DAYS',
}

export interface TermRow {
  term: string
  costMicros: number
  clicks: number
  conversions: number
}

export function filterTerms(rows: TermRow[], o: { minCost?: number; conv?: number }): TermRow[] {
  return rows
    .filter(r => o.minCost == null || r.costMicros >= o.minCost * 1e6)
    .filter(r => o.conv == null || r.conversions <= o.conv)
    .sort((a, b) => b.costMicros - a.costMicros)
}

export async function runTerms(opts: { profile?: string; last?: string; minCost?: string; conv?: string; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const preset = TERMS_PRESETS[opts.last ?? '30d']
  if (!preset) throw new Error(`--last must be one of: ${Object.keys(TERMS_PRESETS).join(', ')}`)
  const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
    `SELECT search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.conversions FROM search_term_view WHERE segments.date DURING ${preset}`)
  const rows: TermRow[] = res.rows.map(r => ({
    term: String(r['searchTermView.searchTerm'] ?? ''),
    costMicros: Number(r['metrics.costMicros'] ?? 0),
    clicks: Number(r['metrics.clicks'] ?? 0),
    conversions: Number(r['metrics.conversions'] ?? 0),
  }))
  const filtered = filterTerms(rows, {
    minCost: opts.minCost != null ? Number(opts.minCost) : undefined,
    conv: opts.conv != null ? Number(opts.conv) : undefined,
  })
  const fmt = formatFromFlags(opts)
  if (fmt === 'json') {
    // raw micros on purpose: this shape pipes into `adops gads negatives plan -`
    console.log(JSON.stringify(filtered.map(r => ({ term: r.term, cost_micros: r.costMicros, clicks: r.clicks, conversions: r.conversions })), null, 2))
    return
  }
  printTable({
    columns: ['term', 'cost', 'clicks', 'conv'],
    rows: filtered.map(r => ({ term: r.term, cost: usd(r.costMicros), clicks: r.clicks, conv: r.conversions })),
  }, fmt)
}
