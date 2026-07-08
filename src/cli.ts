#!/usr/bin/env node
import { Command } from 'commander'
import pc from 'picocolors'
import { runAccounts } from './commands/accounts.js'
import { runAdsList, runAdsStatus } from './commands/ads.js'
import { runAudit } from './commands/audit.js'
import { runAuthGoogle, runAuthMeta } from './commands/auth.js'
import { runBudgetsList, runBudgetsSet } from './commands/budgets.js'
import { runCampaignsList, runCampaignsStatus } from './commands/campaigns.js'
import { runExport } from './commands/export.js'
import { runFatigue } from './commands/fatigue.js'
import { runInsights } from './commands/insights.js'
import { runKeywordsAdd, runKeywordsBid, runKeywordsList, runKeywordsStatus } from './commands/keywords.js'
import { runNegatives } from './commands/negatives.js'
import { runApply, runLog, runPlanList, runPlanShow } from './commands/plancmd.js'
import { runQuery } from './commands/query.js'
import { runReport } from './commands/report.js'
import { runSpend } from './commands/spend.js'
import { runTerms } from './commands/terms.js'
import { runUrlsCheck } from './commands/urls.js'
import { runWatch } from './commands/watch.js'

const program = new Command('adops')
program
  .version('0.1.0')
  .description('The Google Ads CLI Google never shipped — plus a cross-platform reporting layer for Meta. Reads are free; writes plan first.')
  .option('-p, --profile <name>', 'profile from ~/.config/adops/config.toml')

type Fn = (...args: any[]) => Promise<number | void>
const wrap = (fn: Fn) => async (...args: any[]) => {
  try {
    const code = await fn(...args)
    if (typeof code === 'number') process.exitCode = code
  } catch (e) {
    console.error(pc.red(`error: ${e instanceof Error ? e.message : String(e)}`))
    process.exitCode = 1
  }
}
const g = (cmd: any) => cmd.optsWithGlobals()

// -- auth -------------------------------------------------------------------
const auth = program.command('auth').description('connect platform credentials')
auth.command('google')
  .description('OAuth desktop flow; refresh token → credentials.json (0600)')
  .option('--client-id <id>').option('--client-secret <secret>')
  .action(wrap(async (opts: any) => runAuthGoogle(opts)))
auth.command('meta')
  .description('store a system-user access token')
  .option('--token <token>')
  .action(wrap(async (opts: any) => runAuthMeta(opts)))

// -- cross-platform -----------------------------------------------------------
program.command('accounts').description('list accessible accounts, both platforms')
  .option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runAccounts(g(cmd))))

program.command('report').description('cross-platform campaign report')
  .argument('[preset]', 'last-7d | last-30d | mtd', 'last-7d')
  .option('--json').option('--csv')
  .action(wrap(async (preset: string, _o: any, cmd: any) => runReport(preset, g(cmd))))

program.command('spend').description('month-to-date pacing vs budgets, blended CAC')
  .option('--as-of <date>', 'YYYY-MM-DD (testing/backfill)')
  .option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runSpend(g(cmd))))

program.command('audit').description('QA checklist: disapprovals, budget-capped, zero-impression, active-no-spend')
  .option('--strict', 'exit 2 when findings exist')
  .option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runAudit(g(cmd))))

program.command('watch').description('evaluate alert rules from watch.toml; exit 2 on trigger')
  .option('--config <file>', 'default: ~/.config/adops/watch.toml')
  .option('--notify <webhook>', 'POST alerts as JSON {text}')
  .option('--as-of <date>')
  .action(wrap(async (_o: any, cmd: any) => runWatch(g(cmd))))

program.command('export').description('account structure → JSON files (put it in git)')
  .argument('[dir]', 'output directory', 'adops-export')
  .action(wrap(async (dir: string, _o: any, cmd: any) => runExport(dir, g(cmd))))

const plan = program.command('plan').description('inspect staged plans')
plan.command('show').argument('<id>').action(wrap(async (id: string) => runPlanShow(id)))
plan.command('list').option('--json').option('--csv').action(wrap(async (_o: any, cmd: any) => runPlanList(g(cmd))))

program.command('apply').description('execute a staged plan (native validate-only runs first)')
  .argument('<id>')
  .option('--validate', 'stop after the platform dry-run; change nothing')
  .action(wrap(async (id: string, _o: any, cmd: any) => runApply(id, g(cmd))))

program.command('log').description('receipts of applied mutations')
  .option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runLog(g(cmd))))

// -- google (primary surface: the Ads Editor Google never shipped) ------------
const gads = program.command('gads').description('Google Ads — browse and bulk-edit through plan → apply')

gads.command('query').description('raw GAQL passthrough (searchStream)')
  .argument('<gaql>')
  .option('--json').option('--csv')
  .action(wrap(async (gaql: string, _o: any, cmd: any) => runQuery(gaql, g(cmd))))

// browse + bulk status editing — the core Ads-Editor loop
const campaigns = gads.command('campaigns').description('list and bulk pause/enable campaigns')
campaigns.command('list').option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runCampaignsList(g(cmd))))
campaigns.command('pause').requiredOption('--id <ids>', 'comma/space separated campaign ids').option('--apply')
  .action(wrap(async (_o: any, cmd: any) => runCampaignsStatus('pause', g(cmd))))
campaigns.command('enable').requiredOption('--id <ids>').option('--apply')
  .action(wrap(async (_o: any, cmd: any) => runCampaignsStatus('enable', g(cmd))))

const keywords = gads.command('keywords').description('list, add, pause/enable, and re-bid keywords')
keywords.command('list').option('--adgroup <id>', 'filter to one ad group').option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runKeywordsList(g(cmd))))
keywords.command('add').description('stage positive keywords into an ad group')
  .requiredOption('--adgroup <id>').requiredOption('--terms <list>', 'comma-separated')
  .option('--match <type>', 'exact | phrase | broad', 'broad').option('--apply')
  .action(wrap(async (_o: any, cmd: any) => runKeywordsAdd(g(cmd))))
keywords.command('pause').requiredOption('--id <ids>', 'adGroupId~criterionId, comma/space separated').option('--apply')
  .action(wrap(async (_o: any, cmd: any) => runKeywordsStatus('pause', g(cmd))))
keywords.command('enable').requiredOption('--id <ids>').option('--apply')
  .action(wrap(async (_o: any, cmd: any) => runKeywordsStatus('enable', g(cmd))))
keywords.command('bid').description('stage a max-CPC change')
  .requiredOption('--id <id>', 'adGroupId~criterionId').requiredOption('--cpc <usd>').option('--apply')
  .action(wrap(async (_o: any, cmd: any) => runKeywordsBid(g(cmd))))

const ads = gads.command('ads').description('list and bulk pause/enable ads')
ads.command('list').option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runAdsList(g(cmd))))
ads.command('pause').requiredOption('--id <ids>', 'adGroupId~adId, comma/space separated').option('--apply')
  .action(wrap(async (_o: any, cmd: any) => runAdsStatus('pause', g(cmd))))
ads.command('enable').requiredOption('--id <ids>').option('--apply')
  .action(wrap(async (_o: any, cmd: any) => runAdsStatus('enable', g(cmd))))

gads.command('terms').description('search-terms waste finder')
  .option('--last <preset>', '7d | 14d | 30d', '30d')
  .option('--min-cost <usd>')
  .option('--conv <n>', 'max conversions (e.g. 0)')
  .option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runTerms(g(cmd))))

const negatives = gads.command('negatives').description('campaign-level negative keywords')
negatives.command('plan').description('stage negatives from stdin JSON or --terms')
  .argument('[source]', 'use - to read JSON from stdin')
  .option('--terms <list>', 'comma-separated terms')
  .requiredOption('--campaign <id>')
  .option('--match <type>', 'exact | phrase | broad', 'exact')
  .action(wrap(async (source: string | undefined, _o: any, cmd: any) => runNegatives('plan', source, g(cmd))))
negatives.command('add').description('like plan, but --apply executes immediately')
  .argument('[source]', 'use - to read JSON from stdin')
  .option('--terms <list>')
  .requiredOption('--campaign <id>')
  .option('--match <type>', 'exact | phrase | broad', 'exact')
  .option('--apply')
  .action(wrap(async (source: string | undefined, _o: any, cmd: any) => runNegatives('add', source, g(cmd))))

const budgets = gads.command('budgets').description('campaign budgets and pacing')
budgets.command('list').option('--as-of <date>').option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runBudgetsList(g(cmd))))
budgets.command('set').description('stage a daily-budget change')
  .requiredOption('--budget <id>', 'campaign budget id (see budgets list)')
  .requiredOption('--daily <usd>')
  .option('--apply')
  .action(wrap(async (_o: any, cmd: any) => runBudgetsSet(g(cmd))))

const urls = gads.command('urls').description('final-URL health')
urls.command('check').description('GET every enabled final URL; report non-2xx, redirects, missing utm')
  .option('--strict', 'exit 2 when issues exist')
  .option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runUrlsCheck(g(cmd))))

// -- meta (reporting layer; Meta ships its own official CLI for writes) --------
const meta = program.command('meta').description('Meta Ads — reporting (writes live in Meta’s own Ads CLI)')

meta.command('insights').description('insights at any level, breakdowns, paging handled')
  .option('--level <level>', 'account | campaign | adset | ad', 'campaign')
  .option('--last <preset>', '7d | 14d | 30d | month', '7d')
  .option('--since <date>').option('--until <date>')
  .option('--by <breakdowns>', 'e.g. age,gender or publisher_platform')
  .option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runInsights(g(cmd))))

meta.command('fatigue').description('frequency + CTR-decay report (7d vs prior 7d)')
  .option('--freq <n>', 'frequency threshold', '4')
  .option('--decline <ratio>', 'CTR decline threshold', '0.3')
  .option('--as-of <date>')
  .option('--all', 'show every ad, not just flagged')
  .option('--json').option('--csv')
  .action(wrap(async (_o: any, cmd: any) => runFatigue(g(cmd))))

program.parseAsync().catch(e => {
  console.error(pc.red(`error: ${e instanceof Error ? e.message : String(e)}`))
  process.exitCode = 1
})
