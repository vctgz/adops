import { resolveProfile } from '../core/config.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { applyPlan, listPlans, loadPlan, readReceipts } from '../core/plan.js'

export async function runPlanShow(id: string): Promise<void> {
  const plan = loadPlan(id)
  console.log(`${plan.id} · ${plan.platform} · profile ${plan.profile} · ${plan.created}`)
  console.log(plan.summary)
  for (const op of plan.ops) console.log(`  ${op.describe}`)
}

export async function runPlanList(opts: { json?: boolean; csv?: boolean }): Promise<void> {
  const plans = listPlans()
  if (!plans.length) {
    console.log('no plans yet — write commands create them (e.g. adops gads negatives plan)')
    return
  }
  printTable({
    columns: ['id', 'created', 'profile', 'summary'],
    rows: plans.map(p => ({ id: p.id, created: p.created, profile: p.profile, summary: p.summary })),
  }, formatFromFlags(opts))
}

export async function runApply(id: string, opts: { profile?: string; validate?: boolean }): Promise<void> {
  const plan = loadPlan(id)
  const rp = resolveProfile(opts.profile ?? (plan.profile === 'default' ? undefined : plan.profile))
  if (rp.name !== plan.profile) {
    console.error(`adops: plan was written for profile "${plan.profile}", applying with "${rp.name}"`)
  }
  const receipt = await applyPlan(plan, rp.profile, { validateOnly: opts.validate ?? false })
  if (!receipt) {
    console.log(`validate-only passed — nothing changed. run without --validate to execute.`)
    return
  }
  console.log(`applied ${plan.ops.length} operations · receipt ${receipt.id} → ~/.adops/log.jsonl`)
}

export async function runLog(opts: { json?: boolean; csv?: boolean }): Promise<void> {
  const receipts = readReceipts()
  if (!receipts.length) {
    console.log('no receipts — nothing has been applied yet')
    return
  }
  printTable({
    columns: ['id', 'plan', 'at', 'ops'],
    rows: receipts.map(r => ({ id: r.id, plan: r.planId, at: r.at, ops: r.opCount })),
  }, formatFromFlags(opts))
}
