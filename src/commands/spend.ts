import { googleCustomerId, metaAdAccount, resolveProfile, type ResolvedProfile } from '../core/config.js'
import { pct, usd } from '../core/money.js'
import { formatFromFlags, printTable, type Table } from '../core/output.js'
import { gaqlSearch } from '../platforms/google.js'
import { insights, sumAction } from '../platforms/meta.js'

export interface SpendRow {
  platform: string
  spendMicros: number
  budgetMicros?: number
  conversions: number
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function fetchSpendRows(rp: ResolvedProfile): Promise<SpendRow[]> {
  const p = rp.profile
  const budgets = p.budgets ?? {}
  const rows: SpendRow[] = []
  try {
    const cid = googleCustomerId(p)
    const res = await gaqlSearch(p, cid, 'SELECT metrics.cost_micros, metrics.conversions FROM customer WHERE segments.date DURING THIS_MONTH')
    rows.push({
      platform: 'google',
      spendMicros: res.rows.reduce((s, r) => s + Number(r['metrics.costMicros'] ?? 0), 0),
      conversions: res.rows.reduce((s, r) => s + Number(r['metrics.conversions'] ?? 0), 0),
      budgetMicros: budgets.google != null ? budgets.google * 1e6 : undefined,
    })
  } catch (e) {
    console.error(`adops: skipping google — ${errMsg(e)}`)
  }
  try {
    const acct = metaAdAccount(p)
    const data = await insights(acct, { level: 'account', datePreset: 'this_month', fields: ['spend', 'actions'] })
    rows.push({
      platform: 'meta',
      spendMicros: data.reduce((s, r) => s + Math.round(Number(r.spend ?? 0) * 1e6), 0),
      conversions: data.reduce((s, r) => s + sumAction(r, p.meta_conversion_action), 0),
      budgetMicros: budgets.meta != null ? budgets.meta * 1e6 : undefined,
    })
  } catch (e) {
    console.error(`adops: skipping meta — ${errMsg(e)}`)
  }
  if (!rows.length) throw new Error('no platform reachable — run `adops auth` and configure a profile')
  return rows
}

export function paceTable(rows: SpendRow[], asOf: Date): { table: Table; summary: string } {
  const day = asOf.getUTCDate()
  const daysInMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0)).getUTCDate()
  const fraction = day / daysInMonth
  const table: Table = {
    columns: ['platform', 'spend', 'budget', 'pace', 'projected'],
    rows: rows.map(r => ({
      platform: r.platform,
      spend: usd(r.spendMicros, 0),
      budget: r.budgetMicros != null ? usd(r.budgetMicros, 0) : '—',
      pace: r.budgetMicros ? pct(r.spendMicros / (r.budgetMicros * fraction)) : '—',
      projected: usd(Math.round(r.spendMicros / fraction), 0),
    })),
  }
  const totalSpend = rows.reduce((s, r) => s + r.spendMicros, 0)
  const totalBudget = rows.reduce((s, r) => s + (r.budgetMicros ?? 0), 0)
  const conv = rows.reduce((s, r) => s + r.conversions, 0)
  const cac = conv > 0 ? usd(Math.round(totalSpend / conv)) : '—'
  const summary = `blended ${usd(totalSpend, 0)} / ${totalBudget ? usd(totalBudget, 0) : '—'} · ${Math.round(conv).toLocaleString('en-US')} conv · ${cac} CAC · day ${day}/${daysInMonth}`
  return { table, summary }
}

export async function runSpend(opts: { profile?: string; asOf?: string; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const rows = await fetchSpendRows(rp)
  const asOf = opts.asOf ? new Date(`${opts.asOf}T12:00:00Z`) : new Date()
  const { table, summary } = paceTable(rows, asOf)
  const fmt = formatFromFlags(opts)
  if (fmt === 'json') {
    const day = asOf.getUTCDate()
    const days = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0)).getUTCDate()
    console.log(JSON.stringify(rows.map(r => ({
      platform: r.platform,
      spend_micros: r.spendMicros,
      budget_micros: r.budgetMicros ?? null,
      conversions: r.conversions,
      pace: r.budgetMicros ? r.spendMicros / (r.budgetMicros * (day / days)) : null,
      projected_micros: Math.round(r.spendMicros / (day / days)),
    })), null, 2))
    return
  }
  printTable(table, fmt)
  console.log(summary)
}
