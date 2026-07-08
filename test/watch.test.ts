import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { evaluateRules, loadRules, runWatch } from '../src/commands/watch.js'
import { setFetchImpl } from '../src/core/http.js'

const RP = { name: 'test', profile: { currency: 'USD', meta_conversion_action: 'purchase', google_customer_id: '123' } as any }
const ASOF = new Date('2026-07-19T12:00:00Z')

const day = (date: string, cost: number) => ({
  segments: { date },
  metrics: { costMicros: String(cost * 1e6), conversions: 1 },
})

function googleStream(rows: unknown[]) {
  return [{ results: rows, fieldMask: 'segments.date,metrics.costMicros,metrics.conversions' }]
}

beforeEach(() => {
  process.env.GOOGLE_ADS_ACCESS_TOKEN = 'tok'
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev'
})
afterEach(() => {
  setFetchImpl(null)
  delete process.env.GOOGLE_ADS_ACCESS_TOKEN
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
})

const SPIKE = googleStream([
  day('2026-07-11', 100), day('2026-07-12', 100), day('2026-07-13', 100), day('2026-07-14', 100),
  day('2026-07-15', 100), day('2026-07-16', 100), day('2026-07-17', 100), day('2026-07-18', 350),
])
const QUIET = googleStream([
  day('2026-07-11', 100), day('2026-07-12', 100), day('2026-07-13', 100), day('2026-07-14', 100),
  day('2026-07-15', 100), day('2026-07-16', 100), day('2026-07-17', 100), day('2026-07-18', 120),
])

describe('evaluateRules', () => {
  it('flags a spend spike vs trailing average', async () => {
    setFetchImpl(async () => new Response(JSON.stringify(SPIKE), { status: 200 }))
    const alerts = await evaluateRules([{ type: 'spend_spike', platform: 'google', threshold: 2 }], RP, ASOF)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].message).toContain('$350')
  })

  it('stays quiet under threshold', async () => {
    setFetchImpl(async () => new Response(JSON.stringify(QUIET), { status: 200 }))
    const alerts = await evaluateRules([{ type: 'spend_spike', platform: 'google', threshold: 2 }], RP, ASOF)
    expect(alerts).toHaveLength(0)
  })

  it('counts disapproved ads', async () => {
    setFetchImpl(async () => new Response(JSON.stringify([{
      results: [{ adGroupAd: { ad: { id: '1' } } }, { adGroupAd: { ad: { id: '2' } } }, { adGroupAd: { ad: { id: '3' } } }],
      fieldMask: 'adGroupAd.ad.id',
    }]), { status: 200 }))
    const alerts = await evaluateRules([{ type: 'disapprovals', platform: 'google', threshold: 2 }], RP, ASOF)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].message).toContain('3 disapproved')
  })
})

describe('runWatch exit codes', () => {
  let cfg = ''
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'adops-watch-'))
    cfg = join(dir, 'watch.toml')
    writeFileSync(cfg, '[[rule]]\ntype = "spend_spike"\nplatform = "google"\nthreshold = 2.0\n')
    process.env.ADOPS_CONFIG_DIR = dir
    process.env.GOOGLE_ADS_CUSTOMER_ID = '123'
  })
  afterEach(() => {
    delete process.env.ADOPS_CONFIG_DIR
    delete process.env.GOOGLE_ADS_CUSTOMER_ID
  })

  it('exits 2 on trigger', async () => {
    setFetchImpl(async () => new Response(JSON.stringify(SPIKE), { status: 200 }))
    expect(await runWatch({ config: cfg, asOf: '2026-07-19' })).toBe(2)
  })

  it('exits 0 when quiet', async () => {
    setFetchImpl(async () => new Response(JSON.stringify(QUIET), { status: 200 }))
    expect(await runWatch({ config: cfg, asOf: '2026-07-19' })).toBe(0)
  })
})

describe('loadRules', () => {
  it('rejects empty rule files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adops-watch-'))
    const f = join(dir, 'watch.toml')
    writeFileSync(f, '# no rules\n')
    expect(() => loadRules(f)).toThrowError(/no \[\[rule\]\]/)
  })
})
