import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { googleCustomerId, metaAdAccount, resolveProfile } from '../core/config.js'
import { gaqlSearch } from '../platforms/google.js'
import { ads as metaAds, adsets as metaAdsets, campaigns as metaCampaigns } from '../platforms/meta.js'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Serialize account structure to JSON files — diff-able, git-able. */
export async function runExport(dir: string | undefined, opts: { profile?: string }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const out = dir ?? 'adops-export'
  const written: string[] = []
  const write = (rel: string, data: unknown) => {
    const file = join(out, rel)
    mkdirSync(join(out, rel.split('/')[0]), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
    written.push(file)
  }

  try {
    const cid = googleCustomerId(rp.profile)
    const q = (gaql: string) => gaqlSearch(rp.profile, cid, gaql)
    write('google/campaigns.json', (await q(
      `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'`)).rows)
    write('google/ad_groups.json', (await q(
      `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'`)).rows)
    write('google/ads.json', (await q(
      `SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status, ad_group.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'`)).rows)
  } catch (e) {
    console.error(`adops: skipping google export — ${errMsg(e)}`)
  }

  try {
    const acct = metaAdAccount(rp.profile)
    write('meta/campaigns.json', await metaCampaigns(acct))
    write('meta/adsets.json', await metaAdsets(acct))
    write('meta/ads.json', await metaAds(acct))
  } catch (e) {
    console.error(`adops: skipping meta export — ${errMsg(e)}`)
  }

  if (!written.length) throw new Error('nothing exported — no platform reachable')
  for (const f of written) console.log(f)
  console.log(`exported ${written.length} file(s) → ${out}/ (put it in git)`)
}
