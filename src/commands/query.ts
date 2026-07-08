import { googleCustomerId, resolveProfile } from '../core/config.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { gaqlSearch } from '../platforms/google.js'

export async function runQuery(gaql: string, opts: { profile?: string; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile), gaql)
  if (!res.rows.length) {
    console.error('0 rows')
    return
  }
  printTable({ columns: res.fieldMask, rows: res.rows }, formatFromFlags(opts))
}
