import { request } from '../core/http.js'
import { loadCreds, type Profile } from '../core/config.js'

/** Pinned deliberately — Google ships ~3 versions/year; bump here only, nowhere else. */
export const GOOGLE_ADS_API_VERSION = 'v21'
const BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`

let cachedToken: { token: string; exp: number } | undefined

export async function accessToken(): Promise<string> {
  const envTok = process.env.GOOGLE_ADS_ACCESS_TOKEN
  if (envTok) return envTok
  if (cachedToken && Date.now() < cachedToken.exp - 60_000) return cachedToken.token
  const creds = loadCreds().google ?? {}
  const client_id = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? creds.client_id
  const client_secret = process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? creds.client_secret
  const refresh_token = process.env.GOOGLE_ADS_REFRESH_TOKEN ?? creds.refresh_token
  if (!client_id || !client_secret || !refresh_token) {
    throw new Error('google auth missing — run `adops auth google`, or set GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET + GOOGLE_ADS_REFRESH_TOKEN')
  }
  const { body } = await request<{ access_token: string; expires_in?: number }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }).toString(),
  })
  cachedToken = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 }
  return cachedToken.token
}

async function headers(profile: Profile): Promise<Record<string, string>> {
  const dev = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!dev) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is not set. Apply for one in your Google Ads account under Tools > API Center.')
  const h: Record<string, string> = {
    authorization: `Bearer ${await accessToken()}`,
    'developer-token': dev,
    'content-type': 'application/json',
  }
  const login = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? profile.google_login_customer_id
  if (login) h['login-customer-id'] = login.replace(/-/g, '')
  return h
}

export interface GaqlResult {
  fieldMask: string[]
  rows: Array<Record<string, unknown>>
}

/** POST googleAds:searchStream and flatten nested results to fieldMask dot-paths. */
export async function gaqlSearch(profile: Profile, customerId: string, query: string): Promise<GaqlResult> {
  const { body } = await request(`${BASE}/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST',
    headers: await headers(profile),
    body: JSON.stringify({ query }),
  })
  const chunks: any[] = Array.isArray(body) ? body : body ? [body] : []
  const mask: string[] = String(chunks.find(c => c?.fieldMask)?.fieldMask ?? '').split(',').filter(Boolean)
  const rows = chunks.flatMap(c => c?.results ?? []).map((r: any) => flatten(r, mask))
  return { fieldMask: mask, rows }
}

const dig = (obj: any, path: string): unknown => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)

function flatten(result: any, mask: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of mask) out[p] = dig(result, p)
  return out
}

export async function listAccessibleCustomers(profile: Profile): Promise<string[]> {
  const { body } = await request<{ resourceNames?: string[] }>(`${BASE}/customers:listAccessibleCustomers`, {
    headers: await headers(profile),
  })
  return (body.resourceNames ?? []).map(r => r.replace('customers/', ''))
}

/**
 * Generic mutate: every Google Ads write endpoint is
 * `customers/{cid}/{resource}:mutate` with the same envelope. The plan engine
 * builds the operation objects; this just posts them.
 */
export async function mutate(
  profile: Profile,
  customerId: string,
  resource: string,
  operations: Array<Record<string, unknown>>,
  validateOnly: boolean,
): Promise<unknown> {
  const { body } = await request(`${BASE}/customers/${customerId}/${resource}:mutate`, {
    method: 'POST',
    headers: await headers(profile),
    body: JSON.stringify({ operations, validateOnly, partialFailure: false }),
  })
  return body
}

/** Build the `customers/{cid}/{resource}/{id}` resource name Google Ads expects. */
export const resourceName = (customerId: string, resource: string, id: string): string =>
  `customers/${customerId}/${resource}/${id}`
