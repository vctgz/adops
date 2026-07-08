import { googleCustomerId, resolveProfile } from '../core/config.js'
import { dollarsToMicros, pct, usd } from '../core/money.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { applyPlan, createPlan } from '../core/plan.js'
import { gaqlSearch } from '../platforms/google.js'

export async function runBudgetsList(opts: { profile?: string; asOf?: string; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
    `SELECT campaign.name, campaign.id, campaign_budget.id, campaign_budget.amount_micros, metrics.cost_micros FROM campaign WHERE segments.date DURING THIS_MONTH AND campaign.status = 'ENABLED' ORDER BY metrics.cost_micros DESC`)
  const asOf = opts.asOf ? new Date(`${opts.asOf}T12:00:00Z`) : new Date()
  const daysElapsed = asOf.getUTCDate()
  const fmt = formatFromFlags(opts)
  if (fmt === 'json') {
    console.log(JSON.stringify(res.rows.map(r => ({
      campaign: r['campaign.name'], campaign_id: r['campaign.id'], budget_id: r['campaignBudget.id'],
      daily_budget_micros: Number(r['campaignBudget.amountMicros'] ?? 0), mtd_spend_micros: Number(r['metrics.costMicros'] ?? 0),
    })), null, 2))
    return
  }
  printTable({
    columns: ['campaign', 'budget id', 'daily', 'mtd spend', 'pace'],
    rows: res.rows.map(r => {
      const daily = Number(r['campaignBudget.amountMicros'] ?? 0)
      const spend = Number(r['metrics.costMicros'] ?? 0)
      return {
        campaign: String(r['campaign.name'] ?? ''),
        'budget id': String(r['campaignBudget.id'] ?? ''),
        daily: usd(daily),
        'mtd spend': usd(spend, 0),
        pace: daily > 0 ? pct(spend / (daily * daysElapsed)) : '—',
      }
    }),
  }, fmt)
}

export async function runBudgetsSet(opts: { profile?: string; budget?: string; daily?: string; apply?: boolean }): Promise<void> {
  if (!opts.budget || !opts.daily) throw new Error('usage: adops gads budgets set --budget <budget-id> --daily <usd> [--apply]')
  const rp = resolveProfile(opts.profile)
  const customerId = googleCustomerId(rp.profile)
  const amountMicros = dollarsToMicros(opts.daily)
  const plan = createPlan({
    profile: rp.name,
    platform: 'google',
    summary: `set budget ${opts.budget} daily amount → ${usd(amountMicros)}`,
    ops: [{
      kind: 'google.campaign_budget.update' as const,
      customerId,
      budgetId: opts.budget,
      amountMicros,
      describe: `~ budget ${opts.budget} daily → ${usd(amountMicros)}`,
    }],
  })
  console.log(`${plan.id}: ${plan.summary}`)
  if (opts.apply) {
    const receipt = await applyPlan(plan, rp.profile, { validateOnly: false })
    console.log(`applied 1 operation · receipt ${receipt!.id} → ~/.adops/log.jsonl`)
    return
  }
  console.log(`nothing applied · review: adops plan show ${plan.id} · execute: adops apply ${plan.id}`)
}
