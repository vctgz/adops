import { describe, expect, it } from 'vitest'
import { computeWindows, deltaPct, joinPeriods, type ReportRow } from '../src/commands/report.js'

const asOf = new Date('2026-07-19T12:00:00Z')

describe('computeWindows', () => {
  it('last-7d: current is the 7 days ending yesterday, prior is the 7 before that', () => {
    const w = computeWindows('last-7d', asOf)
    expect(w.current).toEqual({ start: '2026-07-12', end: '2026-07-18' })
    expect(w.prior).toEqual({ start: '2026-07-05', end: '2026-07-11' })
  })

  it('last-30d windows are equal length and adjacent', () => {
    const w = computeWindows('last-30d', asOf)
    expect(w.current).toEqual({ start: '2026-06-19', end: '2026-07-18' })
    expect(w.prior.end).toBe('2026-06-18')
    expect(w.prior.start).toBe('2026-05-20')
  })

  it('mtd: current is month-start..today, prior is the equal span before month start', () => {
    const w = computeWindows('mtd', asOf) // day 19 → span 19
    expect(w.current).toEqual({ start: '2026-07-01', end: '2026-07-19' })
    expect(w.prior.end).toBe('2026-06-30')
    expect(w.prior.start).toBe('2026-06-12') // 19 days ending Jun 30
  })

  it('rejects unknown presets', () => {
    expect(() => computeWindows('weekly', asOf)).toThrowError(/preset/)
  })
})

describe('deltaPct', () => {
  it('formats signed percentages', () => {
    expect(deltaPct(150, 100)).toBe('+50%')
    expect(deltaPct(80, 100)).toBe('-20%')
  })
  it('handles a zero prior', () => {
    expect(deltaPct(10, 0)).toBe('new')
    expect(deltaPct(0, 0)).toBe('—')
  })
})

describe('joinPeriods', () => {
  const cur: ReportRow[] = [
    { platform: 'google', campaign: 'Brand', spendMicros: 300e6, impressions: 0, clicks: 0, conversions: 10 },
    { platform: 'google', campaign: 'New', spendMicros: 50e6, impressions: 0, clicks: 0, conversions: 1 },
  ]
  const prior: ReportRow[] = [
    { platform: 'google', campaign: 'Brand', spendMicros: 200e6, impressions: 0, clicks: 0, conversions: 8 },
    { platform: 'google', campaign: 'Dropped', spendMicros: 90e6, impressions: 0, clicks: 0, conversions: 2 },
  ]

  it('joins by platform+campaign, keeps prior-only campaigns as zeroed current', () => {
    const rows = joinPeriods(cur, prior)
    const brand = rows.find(r => r.campaign === 'Brand')!
    expect(brand.spendMicros).toBe(300e6)
    expect(brand.priorSpendMicros).toBe(200e6)
    const dropped = rows.find(r => r.campaign === 'Dropped')!
    expect(dropped.spendMicros).toBe(0)
    expect(dropped.priorSpendMicros).toBe(90e6)
    const nw = rows.find(r => r.campaign === 'New')!
    expect(nw.priorSpendMicros).toBe(0)
    expect(rows).toHaveLength(3)
  })

  it('sorts by current spend desc', () => {
    const rows = joinPeriods(cur, prior)
    expect(rows[0].campaign).toBe('Brand')
  })
})
