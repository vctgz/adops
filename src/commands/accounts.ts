import { resolveProfile } from '../core/config.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { gaqlSearch, listAccessibleCustomers } from '../platforms/google.js'
import { adAccounts } from '../platforms/meta.js'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function runAccounts(opts: { profile?: string; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const rows: Array<Record<string, unknown>> = []

  try {
    const ids = await listAccessibleCustomers(rp.profile)
    for (const id of ids.slice(0, 25)) {
      let name = '?'
      let currency = ''
      try {
        const res = await gaqlSearch(rp.profile, id, 'SELECT customer.descriptive_name, customer.currency_code FROM customer')
        name = String(res.rows[0]?.['customer.descriptiveName'] ?? '?')
        currency = String(res.rows[0]?.['customer.currencyCode'] ?? '')
      } catch { /* MCC-only logins can't query every child; still list the id */ }
      rows.push({ platform: 'google', id, name, currency })
    }
    if (ids.length > 25) console.error(`adops: showing 25 of ${ids.length} google accounts`)
  } catch (e) {
    console.error(`adops: skipping google — ${errMsg(e)}`)
  }

  try {
    for (const a of await adAccounts()) {
      rows.push({ platform: 'meta', id: `act_${a.account_id}`, name: a.name ?? '?', currency: a.currency ?? '' })
    }
  } catch (e) {
    console.error(`adops: skipping meta — ${errMsg(e)}`)
  }

  if (!rows.length) throw new Error('no accounts visible — run `adops auth google` / `adops auth meta` first')
  printTable({ columns: ['platform', 'id', 'name', 'currency'], rows }, formatFromFlags(opts))
}
