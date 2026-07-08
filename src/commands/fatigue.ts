import { metaAdAccount, resolveProfile } from '../core/config.js'
import { addDays, isoDate, usd } from '../core/money.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { insights } from '../platforms/meta.js'

export interface FatigueInput {
  ad_id: string
  ad_name?: string
  frequency?: string | number
  ctr?: string | number
  spend?: string | number
}

export interface FatigueRow {
  adId: string
  ad: string
  frequency: number
  ctr: number
  ctrPrev: number | null
  decline: number | null
  spendMicros: number
  reasons: string[]
}

/** Pure: join current vs prior window by ad_id and flag frequency / CTR decay. */
export function computeFatigue(current: FatigueInput[], prior: FatigueInput[], t: { freq: number; decline: number }): FatigueRow[] {
  const prevById = new Map(prior.map(p => [p.ad_id, p]))
  return current.map(c => {
    const prev = prevById.get(c.ad_id)
    const frequency = Number(c.frequency ?? 0)
    const ctr = Number(c.ctr ?? 0)
    const ctrPrev = prev?.ctr != null ? Number(prev.ctr) : null
    const decline = ctrPrev && ctrPrev > 0 ? (ctrPrev - ctr) / ctrPrev : null
    const reasons: string[] = []
    if (frequency >= t.freq) reasons.push(`frequency ${frequency.toFixed(1)}`)
    if (decline != null && decline >= t.decline) reasons.push(`ctr -${Math.round(decline * 100)}%`)
    return {
      adId: c.ad_id,
      ad: String(c.ad_name ?? c.ad_id),
      frequency,
      ctr,
      ctrPrev,
      decline,
      spendMicros: Math.round(Number(c.spend ?? 0) * 1e6),
      reasons,
    }
  }).sort((a, b) => b.spendMicros - a.spendMicros)
}

export async function runFatigue(opts: { profile?: string; freq?: string; decline?: string; asOf?: string; all?: boolean; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const acct = metaAdAccount(rp.profile)
  const asOf = opts.asOf ? new Date(`${opts.asOf}T12:00:00Z`) : new Date()
  const fields = ['ad_id', 'ad_name', 'frequency', 'ctr', 'spend']
  const current = await insights(acct, { level: 'ad', fields, since: isoDate(addDays(asOf, -7)), until: isoDate(addDays(asOf, -1)) })
  const prior = await insights(acct, { level: 'ad', fields, since: isoDate(addDays(asOf, -14)), until: isoDate(addDays(asOf, -8)) })
  const rows = computeFatigue(current as FatigueInput[], prior as FatigueInput[], {
    freq: Number(opts.freq ?? 4),
    decline: Number(opts.decline ?? 0.3),
  })
  const flagged = rows.filter(r => r.reasons.length > 0)
  const show = opts.all ? rows : flagged
  const fmt = formatFromFlags(opts)
  if (fmt === 'json') {
    console.log(JSON.stringify(show.map(r => ({
      ad_id: r.adId, ad: r.ad, frequency: r.frequency, ctr: r.ctr, ctr_prev: r.ctrPrev,
      ctr_decline: r.decline, spend_micros: r.spendMicros, reasons: r.reasons,
    })), null, 2))
    return
  }
  if (!show.length) {
    console.log(`no fatigued ads — ${rows.length} ad(s) checked (freq < ${opts.freq ?? 4}, ctr decline < ${Math.round(Number(opts.decline ?? 0.3) * 100)}%)`)
    return
  }
  printTable({
    columns: ['ad', 'spend 7d', 'freq', 'ctr', 'prev ctr', 'reason'],
    rows: show.map(r => ({
      ad: r.ad,
      'spend 7d': usd(r.spendMicros),
      freq: r.frequency.toFixed(1),
      ctr: `${(r.ctr * 1).toFixed(2)}%`,
      'prev ctr': r.ctrPrev != null ? `${r.ctrPrev.toFixed(2)}%` : '—',
      reason: r.reasons.join(', ') || '—',
    })),
  }, fmt)
  console.log(`${flagged.length} of ${rows.length} ads flagged — pausing stays manual in v0.1 (meta fatigue --stage-pauses is on the roadmap)`)
}
