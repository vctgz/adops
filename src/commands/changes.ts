import { googleCustomerId, resolveProfile } from '../core/config.js'
import { formatFromFlags, printTable } from '../core/output.js'
import { gaqlSearch } from '../platforms/google.js'

// change_event only covers the last 30 days and REQUIRES a LIMIT (<= 10000).
export const CHANGES_PRESETS: Record<string, string> = {
  today: 'TODAY',
  '1d': 'TODAY',
  '7d': 'LAST_7_DAYS',
  '14d': 'LAST_14_DAYS',
  '30d': 'LAST_30_DAYS',
}

const RESOURCE_SHORT: Record<string, string> = {
  CAMPAIGN: 'campaign',
  AD_GROUP: 'ad group',
  AD_GROUP_AD: 'ad',
  AD_GROUP_CRITERION: 'keyword',
  CAMPAIGN_CRITERION: 'campaign neg',
  CAMPAIGN_BUDGET: 'budget',
}

export function buildChangesQuery(preset: string, user?: string): string {
  const during = CHANGES_PRESETS[preset]
  if (!during) throw new Error(`--last must be one of: ${Object.keys(CHANGES_PRESETS).join(', ')} (change_event covers 30 days max)`)
  const where = [`change_event.change_date_time DURING ${during}`]
  if (user) where.push(`change_event.user_email = '${user.replace(/'/g, '')}'`)
  // LIMIT is mandatory for change_event; ORDER newest first.
  return `SELECT change_event.change_date_time, change_event.user_email, change_event.client_type, change_event.change_resource_type, change_event.resource_change_operation, change_event.changed_fields FROM change_event WHERE ${where.join(' AND ')} ORDER BY change_event.change_date_time DESC LIMIT 1000`
}

export interface ChangeRow {
  when: string
  user: string
  op: string
  resource: string
  fields: string
  client: string
}

export function mapChangeRows(rows: Array<Record<string, unknown>>): ChangeRow[] {
  return rows.map(r => {
    const rt = String(r['changeEvent.changeResourceType'] ?? '')
    const fields = r['changeEvent.changedFields']
    return {
      when: String(r['changeEvent.changeDateTime'] ?? '').replace(/\+.*$/, '').trim(),
      user: String(r['changeEvent.userEmail'] ?? ''),
      op: String(r['changeEvent.resourceChangeOperation'] ?? ''),
      resource: RESOURCE_SHORT[rt] ?? rt.toLowerCase(),
      fields: typeof fields === 'string' ? fields : Array.isArray(fields) ? fields.join(', ') : '',
      client: String(r['changeEvent.clientType'] ?? '').replace('GOOGLE_ADS_', '').toLowerCase(),
    }
  })
}

export async function runChanges(opts: { profile?: string; last?: string; user?: string; json?: boolean; csv?: boolean }): Promise<void> {
  const rp = resolveProfile(opts.profile)
  const res = await gaqlSearch(rp.profile, googleCustomerId(rp.profile), buildChangesQuery(opts.last ?? '7d', opts.user))
  const rows = mapChangeRows(res.rows)
  const fmt = formatFromFlags(opts)
  if (fmt === 'json') {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  if (!rows.length) {
    console.log('no changes in that window')
    return
  }
  printTable({
    columns: ['when', 'user', 'op', 'resource', 'fields', 'via'],
    rows: rows.map(r => ({ when: r.when, user: r.user, op: r.op, resource: r.resource, fields: r.fields, via: r.client })),
  }, fmt)
}
