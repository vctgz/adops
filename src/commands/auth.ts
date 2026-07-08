import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { request } from '../core/http.js'
import { saveCreds } from '../core/config.js'
import { me } from '../platforms/meta.js'

const SCOPE = 'https://www.googleapis.com/auth/adwords'

/** OAuth desktop (loopback) flow. Bring your own Google Cloud OAuth client id and secret. */
export async function runAuthGoogle(opts: { clientId?: string; clientSecret?: string }): Promise<void> {
  const client_id = opts.clientId ?? process.env.GOOGLE_ADS_OAUTH_CLIENT_ID
  const client_secret = opts.clientSecret ?? process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET
  if (!client_id || !client_secret) {
    throw new Error('pass --client-id/--client-secret (a "Desktop app" OAuth client from Google Cloud) or set GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET')
  }

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const c = url.searchParams.get('code')
      const err = url.searchParams.get('error')
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(c ? 'adops: authorized — you can close this tab.' : `adops: ${err ?? 'no code received'}`)
      if (c || err) {
        server.close()
        c ? resolve({ code: c, redirectUri }) : reject(new Error(`oauth error: ${err}`))
      }
    })
    let redirectUri = ''
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') return reject(new Error('could not bind loopback port'))
      redirectUri = `http://127.0.0.1:${addr.port}/callback`
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
        access_type: 'offline', prompt: 'consent',
      })
      console.log('open this URL to authorize adops:\n\n  ' + authUrl + '\n')
      if (process.platform === 'darwin') spawn('open', [authUrl], { stdio: 'ignore' }).on('error', () => {})
    })
    server.on('error', reject)
  })

  const { body } = await request<{ refresh_token?: string }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id, client_secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
  })
  if (!body.refresh_token) throw new Error('no refresh token returned — remove the app from https://myaccount.google.com/permissions and retry')
  saveCreds({ google: { client_id, client_secret, refresh_token: body.refresh_token } })
  console.log('google: refresh token saved to credentials.json (0600)')
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    console.log('note: you still need GOOGLE_ADS_DEVELOPER_TOKEN — apply in a manager account under Tools → API Center')
  }
}

/** Paste a system-user token (they don't expire every 60 days like user tokens). */
export async function runAuthMeta(opts: { token?: string }): Promise<void> {
  let token = opts.token
  if (!token) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    token = (await rl.question('paste a Meta system-user access token: ')).trim()
    rl.close()
  }
  if (!token) throw new Error('no token given')
  process.env.META_ACCESS_TOKEN = token // so the verification call below uses it
  const who = await me()
  saveCreds({ meta: { access_token: token } })
  console.log(`meta: token verified as "${who?.name ?? who?.id}" — saved to credentials.json (0600)`)
}
