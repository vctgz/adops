import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'
import { configDir, googleCustomerId, loadCreds, resolveProfile } from '../core/config.js'
import { GOOGLE_ADS_API_VERSION, accessToken, gaqlSearch, listAccessibleCustomers } from '../platforms/google.js'

interface Check { ok: boolean; label: string; detail: string; fix?: string }

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Connection self-test: walks the same path a real command takes and reports each step. */
export async function runDoctor(opts: { profile?: string }): Promise<number> {
  const checks: Check[] = []

  // 1. profile + customer id
  let customerId = ''
  try {
    const rp = resolveProfile(opts.profile)
    customerId = googleCustomerId(rp.profile)
    checks.push({ ok: true, label: 'profile', detail: `"${rp.name}", customer ${customerId}` })
  } catch (e) {
    checks.push({ ok: false, label: 'profile', detail: errMsg(e), fix: 'set google_customer_id in ~/.config/adops/config.toml or GOOGLE_ADS_CUSTOMER_ID' })
  }

  // 2. developer token
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  checks.push(devToken
    ? { ok: true, label: 'developer token', detail: 'GOOGLE_ADS_DEVELOPER_TOKEN set' }
    : { ok: false, label: 'developer token', detail: 'GOOGLE_ADS_DEVELOPER_TOKEN not set', fix: 'apply in your Google Ads account under Tools > API Center, then export it' })

  // 3. oauth client + refresh token (creds file or env) and file perms
  const creds = loadCreds().google ?? {}
  const haveClient = !!(process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? creds.client_id) && !!(process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? creds.client_secret)
  const haveRefresh = !!(process.env.GOOGLE_ADS_REFRESH_TOKEN ?? creds.refresh_token)
  checks.push(haveClient && haveRefresh
    ? { ok: true, label: 'oauth credentials', detail: 'client + refresh token present' }
    : { ok: false, label: 'oauth credentials', detail: `${haveClient ? '' : 'client id/secret missing; '}${haveRefresh ? '' : 'refresh token missing'}`.trim(), fix: 'run `adops auth google --client-id <id> --client-secret <secret>`' })

  const credsPath = join(configDir(), 'credentials.json')
  if (existsSync(credsPath)) {
    const mode = statSync(credsPath).mode & 0o777
    checks.push(mode === 0o600
      ? { ok: true, label: 'credentials perms', detail: '0600' }
      : { ok: false, label: 'credentials perms', detail: `0${mode.toString(8)} (should be 0600)`, fix: `chmod 600 ${credsPath}` })
  }

  // 4. token refresh (only if we have the ingredients)
  if ((haveClient && haveRefresh) || process.env.GOOGLE_ADS_ACCESS_TOKEN) {
    try {
      await accessToken()
      checks.push({ ok: true, label: 'token refresh', detail: 'got an access token' })
    } catch (e) {
      checks.push({ ok: false, label: 'token refresh', detail: errMsg(e), fix: 're-run `adops auth google` (refresh token may be revoked)' })
    }
  }

  // 5 + 6. reach the API (needs dev token + auth)
  if (devToken && ((haveClient && haveRefresh) || process.env.GOOGLE_ADS_ACCESS_TOKEN)) {
    const rp = resolveProfile(opts.profile)
    try {
      const ids = await listAccessibleCustomers(rp.profile)
      checks.push({ ok: true, label: 'accessible accounts', detail: `${ids.length} reachable` })
    } catch (e) {
      checks.push({ ok: false, label: 'accessible accounts', detail: errMsg(e), fix: 'check the developer token is approved and the OAuth user has access' })
    }
    if (customerId) {
      try {
        const res = await gaqlSearch(rp.profile, customerId, 'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1')
        const name = res.rows[0]?.['customer.descriptiveName']
        checks.push({ ok: true, label: 'query configured account', detail: name ? `"${name}"` : `customer ${customerId} responded` })
      } catch (e) {
        checks.push({ ok: false, label: 'query configured account', detail: errMsg(e), fix: 'confirm the customer id and (for managed accounts) set google_login_customer_id' })
      }
    }
  }

  // report
  for (const c of checks) {
    const mark = c.ok ? pc.green('✓') : pc.red('✗')
    console.log(`${mark} ${c.label}: ${c.detail}`)
    if (!c.ok && c.fix) console.log(`    ${pc.dim('fix:')} ${c.fix}`)
  }
  console.log(`\napi version: ${GOOGLE_ADS_API_VERSION}`)
  const failed = checks.filter(c => !c.ok).length
  console.log(failed ? pc.red(`${failed} check(s) failed`) : pc.green('all checks passed'))
  return failed ? 1 : 0
}
