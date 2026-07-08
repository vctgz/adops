import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { z } from 'zod'

const ProfileSchema = z.object({
  google_customer_id: z.string().optional(),
  google_login_customer_id: z.string().optional(),
  meta_ad_account: z.string().optional(),
  currency: z.string().default('USD'),
  meta_conversion_action: z.string().default('purchase'),
  budgets: z.object({ google: z.number().optional(), meta: z.number().optional() }).optional(),
})
export type Profile = z.infer<typeof ProfileSchema>

const ConfigSchema = z.object({
  default_profile: z.string().optional(),
  profiles: z.record(ProfileSchema).default({}),
})
export type Config = z.infer<typeof ConfigSchema>

export const configDir = (): string => process.env.ADOPS_CONFIG_DIR ?? join(homedir(), '.config', 'adops')
export const adopsHome = (): string => process.env.ADOPS_HOME ?? join(homedir(), '.adops')

export function loadConfig(): Config {
  const file = join(configDir(), 'config.toml')
  if (!existsSync(file)) return ConfigSchema.parse({})
  return ConfigSchema.parse(parse(readFileSync(file, 'utf8')))
}

export interface ResolvedProfile { name: string; profile: Profile }

export function resolveProfile(name?: string): ResolvedProfile {
  const cfg = loadConfig()
  const names = Object.keys(cfg.profiles)
  const n = name ?? process.env.ADOPS_PROFILE ?? cfg.default_profile ?? (names.length === 1 ? names[0] : undefined)
  if (!n) return { name: 'default', profile: ProfileSchema.parse({}) } // env-only operation is fine
  const profile = cfg.profiles[n]
  if (!profile) throw new Error(`profile "${n}" not found in ${join(configDir(), 'config.toml')}`)
  return { name: n, profile }
}

export function googleCustomerId(p: Profile): string {
  const v = process.env.GOOGLE_ADS_CUSTOMER_ID ?? p.google_customer_id
  if (!v) throw new Error('no Google Ads customer id — set google_customer_id in config.toml or GOOGLE_ADS_CUSTOMER_ID')
  return v.replace(/-/g, '')
}

export function metaAdAccount(p: Profile): string {
  const v = process.env.META_AD_ACCOUNT_ID ?? p.meta_ad_account
  if (!v) throw new Error('no Meta ad account — set meta_ad_account in config.toml or META_AD_ACCOUNT_ID')
  return v.startsWith('act_') ? v : `act_${v}`
}

const CredsSchema = z.object({
  google: z.object({
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
    refresh_token: z.string().optional(),
  }).optional(),
  meta: z.object({ access_token: z.string().optional() }).optional(),
})
export type Credentials = z.infer<typeof CredsSchema>

const credsFile = () => join(configDir(), 'credentials.json')

export function loadCreds(): Credentials {
  if (!existsSync(credsFile())) return {}
  return CredsSchema.parse(JSON.parse(readFileSync(credsFile(), 'utf8')))
}

export function saveCreds(patch: Credentials): void {
  const merged: Credentials = { ...loadCreds() }
  if (patch.google) merged.google = { ...merged.google, ...patch.google }
  if (patch.meta) merged.meta = { ...merged.meta, ...patch.meta }
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(credsFile(), JSON.stringify(merged, null, 2))
  chmodSync(credsFile(), 0o600)
}
