import { request } from '../core/http.js'
import { loadCreds } from '../core/config.js'

/** Pinned deliberately — bump here only, nowhere else. */
export const META_API_VERSION = 'v23.0'
const BASE = `https://graph.facebook.com/${META_API_VERSION}`

function token(): string {
  const t = process.env.META_ACCESS_TOKEN ?? loadCreds().meta?.access_token
  if (!t) throw new Error('meta auth missing — run `adops auth meta` or set META_ACCESS_TOKEN')
  return t
}

/** GET a Graph edge and follow paging.next cursors (never guess offsets). */
export async function graphGet(path: string, params: Record<string, string> = {}, maxPages = 25): Promise<any[]> {
  let url = `${BASE}/${path}?${new URLSearchParams({ ...params, access_token: token() })}`
  const out: any[] = []
  for (let i = 0; i < maxPages && url; i++) {
    const { body } = await request<any>(url)
    if (Array.isArray(body?.data)) out.push(...body.data)
    else if (body) return [body] // node endpoints (e.g. /me) return a single object
    url = body?.paging?.next ?? ''
  }
  return out
}

export interface InsightsOpts {
  level: 'account' | 'campaign' | 'adset' | 'ad'
  fields: string[]
  datePreset?: string
  since?: string
  until?: string
  breakdowns?: string
  timeIncrement?: string
}

export async function insights(account: string, o: InsightsOpts): Promise<any[]> {
  const params: Record<string, string> = { level: o.level, fields: o.fields.join(',') }
  if (o.datePreset) params.date_preset = o.datePreset
  if (o.since && o.until) params.time_range = JSON.stringify({ since: o.since, until: o.until })
  if (o.breakdowns) params.breakdowns = o.breakdowns
  if (o.timeIncrement) params.time_increment = o.timeIncrement
  return graphGet(`${account}/insights`, params)
}

export async function adAccounts(): Promise<any[]> {
  return graphGet('me/adaccounts', { fields: 'name,account_id,account_status,currency' })
}

export async function campaigns(account: string, fields = 'id,name,status,effective_status,objective,daily_budget'): Promise<any[]> {
  return graphGet(`${account}/campaigns`, { fields, limit: '200' })
}

export async function adsets(account: string, fields = 'id,name,status,campaign_id,daily_budget,optimization_goal'): Promise<any[]> {
  return graphGet(`${account}/adsets`, { fields, limit: '200' })
}

export async function ads(account: string, fields = 'id,name,status,adset_id'): Promise<any[]> {
  return graphGet(`${account}/ads`, { fields, limit: '200' })
}

export async function me(): Promise<any> {
  const rows = await graphGet('me', { fields: 'id,name' })
  return rows[0]
}

/** Meta reports conversions inside an `actions` array; pick the configured action_type. */
export function sumAction(row: any, actionType: string): number {
  const a = (row?.actions ?? []).find((x: any) => x.action_type === actionType)
  return a ? Number(a.value) : 0
}
