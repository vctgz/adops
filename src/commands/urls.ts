import { googleCustomerId, resolveProfile } from '../core/config.js'
import { request } from '../core/http.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { gaqlSearch } from '../platforms/google.js'

export interface UrlResult {
  url: string
  status: number | 'error'
  issues: string[]
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export async function checkUrls(urls: string[], concurrency = 8): Promise<UrlResult[]> {
  return mapPool(urls, concurrency, async url => {
    const issues: string[] = []
    if (!/[?&]utm_/.test(url)) issues.push('no utm tags')
    try {
      const res = await request(url, { method: 'GET', redirect: 'follow' }, { okOnly: false, retries: 1 })
      if (res.status >= 400) issues.unshift(`HTTP ${res.status}`)
      else if (res.redirected) issues.push('redirected')
      return { url, status: res.status, issues }
    } catch (e) {
      issues.unshift(e instanceof Error ? e.message : 'request failed')
      return { url, status: 'error' as const, issues }
    }
  })
}

export async function runUrlsCheck(opts: { profile?: string; strict?: boolean; json?: boolean; csv?: boolean }): Promise<number> {
  const rp = resolveProfile(opts.profile)
  const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile),
    `SELECT ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group_ad.status = 'ENABLED' AND campaign.status = 'ENABLED'`)
  const urls = [...new Set(res.rows.flatMap(r => (r['adGroupAd.ad.finalUrls'] as string[] | undefined) ?? []))]
  if (!urls.length) {
    console.log('no enabled final URLs found')
    return 0
  }
  console.error(`checking ${urls.length} unique final URL(s)…`)
  const results = await checkUrls(urls)
  const bad = results.filter(r => r.issues.length > 0)
  printTable({
    columns: ['url', 'status', 'issues'],
    rows: (opts.json || opts.csv ? results : bad).map(r => ({ url: r.url, status: String(r.status), issues: r.issues.join('; ') })),
  }, formatFromFlags(opts))
  if (!bad.length) console.log(`all ${results.length} URLs healthy`)
  return opts.strict && bad.length ? 2 : 0
}
