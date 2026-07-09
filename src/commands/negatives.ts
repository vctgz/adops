import { googleCustomerId, resolveProfile, type ResolvedProfile } from '../core/config.js'
import { applyPlan, createPlan, type Plan } from '../core/plan.js'

const MATCH_TYPES = ['EXACT', 'PHRASE', 'BROAD'] as const
type MatchType = (typeof MATCH_TYPES)[number]

export async function readTermsInput(fromStdin: boolean, termsOpt?: string): Promise<string[]> {
  if (termsOpt) return termsOpt.split(',').map(s => s.trim()).filter(Boolean)
  if (fromStdin) {
    let raw = ''
    for await (const chunk of process.stdin) raw += chunk
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('stdin must be a JSON array — try: adops gads terms --json | adops gads negatives plan -')
    return parsed
      .map((it: any) => (typeof it === 'string' ? it : it?.term ?? it?.search_term ?? it?.['searchTermView.searchTerm'] ?? it?.['search_term_view.search_term']))
      .filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
  }
  throw new Error('no terms given — pipe JSON via `-` or pass --terms "a,b"')
}

export function buildNegativesPlan(rp: ResolvedProfile, campaignId: string, terms: string[], match: MatchType): Plan {
  const customerId = googleCustomerId(rp.profile)
  if (!terms.length) throw new Error('no terms to add')
  return createPlan({
    profile: rp.name,
    platform: 'google',
    summary: `add ${terms.length} ${match.toLowerCase()} negatives → campaign ${campaignId}`,
    ops: terms.map(t => ({
      kind: 'google.campaign_negative.create' as const,
      customerId,
      campaignId,
      text: t,
      matchType: match,
      describe: `+ negative [${match}] "${t}" → campaign ${campaignId}`,
    })),
  })
}

export function buildAdgroupNegativesPlan(rp: ResolvedProfile, adGroupId: string, terms: string[], match: MatchType): Plan {
  const customerId = googleCustomerId(rp.profile)
  if (!terms.length) throw new Error('no terms to add')
  return createPlan({
    profile: rp.name,
    platform: 'google',
    summary: `add ${terms.length} ${match.toLowerCase()} negatives → ad group ${adGroupId}`,
    ops: terms.map(t => ({
      kind: 'google.ad_group_negative.create' as const,
      customerId,
      adGroupId,
      text: t,
      matchType: match,
      describe: `+ negative [${match}] "${t}" → ad group ${adGroupId}`,
    })),
  })
}

export async function runNegatives(
  action: 'plan' | 'add',
  source: string | undefined,
  opts: { profile?: string; terms?: string; campaign?: string; adgroup?: string; match?: string; apply?: boolean },
): Promise<void> {
  if (!opts.campaign && !opts.adgroup) throw new Error('pass --campaign <id> or --adgroup <id> (shared sets are on the roadmap)')
  if (opts.campaign && opts.adgroup) throw new Error('pass either --campaign or --adgroup, not both')
  const match = (opts.match ?? 'exact').toUpperCase() as MatchType
  if (!MATCH_TYPES.includes(match)) throw new Error(`--match must be one of: ${MATCH_TYPES.join(', ').toLowerCase()}`)
  const rp = resolveProfile(opts.profile)
  const terms = await readTermsInput(source === '-', opts.terms)
  const plan = opts.adgroup
    ? buildAdgroupNegativesPlan(rp, opts.adgroup, terms, match)
    : buildNegativesPlan(rp, opts.campaign!, terms, match)
  console.log(`${plan.id}: ${plan.summary}`)
  if (action === 'add' && opts.apply) {
    const receipt = await applyPlan(plan, rp.profile, { validateOnly: false })
    console.log(`applied ${plan.ops.length} operations · receipt ${receipt!.id} → ~/.adops/log.jsonl`)
    return
  }
  console.log(`nothing applied · review: adops plan show ${plan.id} · execute: adops apply ${plan.id}`)
}
