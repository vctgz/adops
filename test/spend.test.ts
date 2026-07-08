import { describe, expect, it } from 'vitest'
import { paceTable } from '../src/commands/spend.js'

describe('paceTable', () => {
  const rows = [
    { platform: 'google', spendMicros: 31_204_000_000, budgetMicros: 50_000_000_000, conversions: 966 },
    { platform: 'meta', spendMicros: 44_890_000_000, budgetMicros: 80_000_000_000, conversions: 1000 },
  ]
  const asOf = new Date('2026-07-19T12:00:00Z') // day 19 of 31

  it('computes pace against elapsed fraction of month', () => {
    const { table } = paceTable(rows, asOf)
    // 31204 / (50000 * 19/31) = 1.0182 → 102%
    expect(table.rows[0].pace).toBe('102%')
    expect(table.rows[0].spend).toBe('$31,204')
  })

  it('projects month-end spend', () => {
    const { table } = paceTable(rows, asOf)
    // 31204 / (19/31) = 50912
    expect(table.rows[0].projected).toBe('$50,912')
  })

  it('summarizes blended CAC and day counter', () => {
    const { summary } = paceTable(rows, asOf)
    expect(summary).toContain('1,966 conv')
    expect(summary).toContain('day 19/31')
    // 76094 / 1966 = 38.70...
    expect(summary).toContain('$38.70')
  })

  it('handles missing budgets', () => {
    const { table } = paceTable([{ platform: 'google', spendMicros: 1_000_000, conversions: 0 }], asOf)
    expect(table.rows[0].budget).toBe('—')
    expect(table.rows[0].pace).toBe('—')
  })
})
