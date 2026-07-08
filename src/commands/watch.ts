import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { z } from 'zod'
import { configDir, googleCustomerId, metaAdAccount, resolveProfile, type ResolvedProfile } from '../core/config.js'
import { request } from '../core/http.js'
import { addDays, isoDate, usd } from '../core/money.js'
import { gaqlSearch } from '../platforms/google.js'
import { insights } from '../platforms/meta.js'

const RuleSchema = z.object({
  type: z.enum(['spend_spike', 'zero_conversions', 'disapprovals']),
  platform: z.enum(['google', 'meta']).default('google'),
  threshold: z.number().positive().default(2),
})
export type Rule = z.infer<typeof RuleSchema>

export interface Alert {
  rule: string
  platform: string
  message: string
}

export function loadRules(file: string): Rule[] {
  if (!existsSync(file)) throw new Error(`no watch config at ${file}. Add [[rule]] entries (type, platform, threshold) to enable alerts.`)
  const doc = parse(readFileSync(file, 'utf8')) as { rule?: unknown }
  const rules = z.array(RuleSchema).parse(doc.rule ?? [])
  if (!rules.length) throw new Error(`${file} has no [[rule]] entries`)
  return rules
}

interface DayRow { date: string; spendMicros: number; conversions: number }

async function dailyRows(rp: ResolvedProfile, platform: 'google' | 'meta', since: Date, until: Date): Promise<DayRow[]> {
  if (platform === 'google') {
    const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
      `SELECT segments.date, metrics.cost_micros, metrics.conversions FROM customer WHERE segments.date BETWEEN '${isoDate(since)}' AND '${isoDate(until)}'`)
    return res.rows
      .map(r => ({ date: String(r['segments.date'] ?? ''), spendMicros: Number(r['metrics.costMicros'] ?? 0), conversions: Number(r['metrics.conversions'] ?? 0) }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }
  const data = await insights(metaAdAccount(rp.profile), {
    level: 'account', fields: ['spend', 'actions'], since: isoDate(since), until: isoDate(until), timeIncrement: '1',
  })
  return data
    .map((r: any) => ({ date: String(r.date_start ?? ''), spendMicros: Math.round(Number(r.spend ?? 0) * 1e6), conversions: 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function evaluateRules(rules: Rule[], rp: ResolvedProfile, asOf: Date): Promise<Alert[]> {
  const alerts: Alert[] = []
  const yesterday = addDays(asOf, -1)
  for (const rule of rules) {
    if (rule.type === 'spend_spike') {
      const rows = await dailyRows(rp, rule.platform, addDays(asOf, -8), yesterday)
      if (rows.length >= 2) {
        const last = rows[rows.length - 1]
        const prior = rows.slice(0, -1)
        const avg = prior.reduce((s, d) => s + d.spendMicros, 0) / prior.length
        if (avg > 0 && last.spendMicros > rule.threshold * avg) {
          alerts.push({ rule: rule.type, platform: rule.platform, message: `${rule.platform}: yesterday ${usd(last.spendMicros, 0)} vs ${usd(Math.round(avg), 0)} trailing avg (> ${rule.threshold}x)` })
        }
      }
    } else if (rule.type === 'zero_conversions') {
      if (rule.platform === 'google') {
        const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
          `SELECT metrics.conversions FROM customer WHERE segments.date BETWEEN '${isoDate(yesterday)}' AND '${isoDate(yesterday)}'`)
        const conv = res.rows.reduce((s, r) => s + Number(r['metrics.conversions'] ?? 0), 0)
        if (conv === 0) alerts.push({ rule: rule.type, platform: 'google', message: 'google: zero conversions yesterday — check tracking' })
      } else {
        const data = await insights(metaAdAccount(rp.profile), { level: 'account', fields: ['actions'], since: isoDate(yesterday), until: isoDate(yesterday) })
        const conv = data.reduce((s: number, r: any) => s + ((r.actions ?? []) as any[]).reduce((x: number, a: any) => x + Number(a.value ?? 0), 0), 0)
        if (conv === 0) alerts.push({ rule: rule.type, platform: 'meta', message: 'meta: zero tracked actions yesterday — check pixel/CAPI' })
      }
    } else if (rule.type === 'disapprovals') {
      if (rule.platform !== 'google') throw new Error('disapprovals rule supports platform = "google" only in v0.1')
      const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
        `SELECT ad_group_ad.ad.id FROM ad_group_ad WHERE ad_group_ad.policy_summary.approval_status = 'DISAPPROVED' AND campaign.status = 'ENABLED'`)
      if (res.rows.length > 0) {
        alerts.push({ rule: rule.type, platform: 'google', message: `google: ${res.rows.length} disapproved ad(s) in enabled campaigns` })
      }
    }
  }
  return alerts
}

export async function runWatch(opts: { profile?: string; config?: string; notify?: string; asOf?: string }): Promise<number> {
  const rp = resolveProfile(opts.profile)
  const rules = loadRules(opts.config ?? join(configDir(), 'watch.toml'))
  const asOf = opts.asOf ? new Date(`${opts.asOf}T12:00:00Z`) : new Date()
  const alerts = await evaluateRules(rules, rp, asOf)
  if (!alerts.length) {
    console.log(`all quiet — ${rules.length} rule(s) checked`)
    return 0
  }
  for (const a of alerts) console.log(`ALERT [${a.rule}] ${a.message}`)
  if (opts.notify) {
    await request(opts.notify, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `adops watch (${rp.name}):\n` + alerts.map(a => `• ${a.message}`).join('\n') }),
    })
  }
  return 2
}
