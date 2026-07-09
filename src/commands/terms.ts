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

export interface NgramRow { gram: string; n: number; costMicros: number; clicks: number; conversions: number; terms: number }

/**
 * Roll search terms up into word n-grams. A term's cost/clicks/conv are counted
 * toward every distinct gram it contains, so shared words ("free", "jobs")
 * surface as cost patterns across many terms. Sorted by cost desc.
 */
export function ngramRollup(rows: TermRow[], sizes: number[]): NgramRow[] {
  const map = new Map<string, NgramRow>()
  for (const r of rows) {
    const words = r.term.toLowerCase().split(/\s+/).filter(Boolean)
    for (const n of sizes) {
      const seen = new Set<string>()
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n).join(' ')
        if (seen.has(gram)) continue
        seen.add(gram)
        const key = `${n}|${gram}`
        const cur = map.get(key) ?? { gram, n, costMicros: 0, clicks: 0, conversions: 0, terms: 0 }
        cur.costMicros += r.costMicros
        cur.clicks += r.clicks
        cur.conversions += r.conversions
        cur.terms += 1
        map.set(key, cur)
      }
    }
  }
  return [...map.values()].sort((a, b) => b.costMicros - a.costMicros)
}

export function parseNgramSizes(raw: string): number[] {
  const sizes = raw.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n >= 1 && n <= 5)
  if (!sizes.length) throw new Error('--ngrams takes sizes like "1,2,3" (1 to 5)')
  return [...new Set(sizes)]
}

export async function runTerms(opts: { profile?: string; last?: string; minCost?: string; conv?: string; ngrams?: string; json?: boolean; csv?: boolean }): Promise<void> {
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

  // --ngrams: roll the (filtered) terms up into word patterns instead of listing them
  if (opts.ngrams) {
    const grams = ngramRollup(filtered, parseNgramSizes(opts.ngrams))
    if (fmt === 'json') {
      console.log(JSON.stringify(grams.map(g => ({ gram: g.gram, n: g.n, cost_micros: g.costMicros, clicks: g.clicks, conversions: g.conversions, terms: g.terms })), null, 2))
      return
    }
    printTable({
      columns: ['gram', 'n', 'cost', 'conv', 'terms'],
      rows: grams.map(g => ({ gram: g.gram, n: g.n, cost: usd(g.costMicros), conv: g.conversions, terms: g.terms })),
    }, fmt)
    return
  }

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
