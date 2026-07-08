export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message)
    this.name = 'HttpError'
  }
}

type FetchLike = typeof globalThis.fetch

let impl: FetchLike = (...args) => globalThis.fetch(...args)

/** Test seam: swap the fetch implementation. Pass null to restore the real one. */
export function setFetchImpl(f: FetchLike | null): void {
  impl = f ?? ((...args) => globalThis.fetch(...args))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export interface RequestOpts {
  retries?: number
  /** When false, non-2xx responses are returned instead of thrown (URL checker needs this). */
  okOnly?: boolean
}

export interface HttpResult<T = unknown> {
  status: number
  headers: Headers
  redirected: boolean
  body: T
}

/** All platform HTTP flows through here: retry/backoff on 429/5xx, Meta usage-header warnings. */
export async function request<T = any>(url: string, init: RequestInit = {}, opts: RequestOpts = {}): Promise<HttpResult<T>> {
  const retries = opts.retries ?? 3
  const base = Number(process.env.ADOPS_RETRY_BASE_MS ?? 500)
  let attempt = 0
  for (;;) {
    const res = await impl(url, init)
    const usage = res.headers.get('x-business-use-case-usage')
    if (usage) warnOnMetaUsage(usage)
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      attempt++
      await sleep(base * 2 ** (attempt - 1))
      continue
    }
    const text = await res.text()
    let body: any
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    if (!res.ok && (opts.okOnly ?? true)) {
      throw new HttpError(res.status, apiErrorMessage(body) ?? `HTTP ${res.status} from ${new URL(url).host}`, body)
    }
    return { status: res.status, headers: res.headers, redirected: res.redirected, body }
  }
}

function apiErrorMessage(body: any): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  if (Array.isArray(body)) return apiErrorMessage(body[0])
  const m = body.error?.message
  return typeof m === 'string' ? m : undefined
}

function warnOnMetaUsage(raw: string): void {
  try {
    const parsed = JSON.parse(raw) as Record<string, Array<Record<string, number>>>
    for (const arr of Object.values(parsed)) {
      for (const u of arr) {
        const max = Math.max(u.call_count ?? 0, u.total_time ?? 0, u.total_cputime ?? 0)
        if (max >= 90) console.error(`adops: meta rate-limit usage at ${max}% — expect throttling soon`)
      }
    }
  } catch { /* header format changed; not worth failing over */ }
}
