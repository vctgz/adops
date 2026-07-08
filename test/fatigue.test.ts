import { describe, expect, it } from 'vitest'
import { computeFatigue } from '../src/commands/fatigue.js'

describe('computeFatigue', () => {
  const thresholds = { freq: 4, decline: 0.3 }

  it('flags high frequency', () => {
    const rows = computeFatigue(
      [{ ad_id: '1', ad_name: 'Burned', frequency: '5.2', ctr: '1.0', spend: '100' }],
      [],
      thresholds,
    )
    expect(rows[0].reasons).toEqual(['frequency 5.2'])
  })

  it('flags CTR decay vs the prior window', () => {
    const rows = computeFatigue(
      [{ ad_id: '1', ad_name: 'Fading', frequency: '2.0', ctr: '0.5', spend: '100' }],
      [{ ad_id: '1', ctr: '1.0' }],
      thresholds,
    )
    expect(rows[0].reasons).toEqual(['ctr -50%'])
    expect(rows[0].decline).toBeCloseTo(0.5)
  })

  it('leaves healthy ads unflagged and sorts by spend', () => {
    const rows = computeFatigue(
      [
        { ad_id: '1', ad_name: 'Small', frequency: '1.5', ctr: '1.1', spend: '10' },
        { ad_id: '2', ad_name: 'Big', frequency: '2.0', ctr: '1.0', spend: '900' },
      ],
      [{ ad_id: '1', ctr: '1.0' }, { ad_id: '2', ctr: '1.1' }],
      thresholds,
    )
    expect(rows.map(r => r.ad)).toEqual(['Big', 'Small'])
    expect(rows.every(r => r.reasons.length === 0)).toBe(true)
  })

  it('handles ads with no prior window', () => {
    const rows = computeFatigue([{ ad_id: '9', frequency: '1', ctr: '2', spend: '5' }], [], thresholds)
    expect(rows[0].decline).toBeNull()
    expect(rows[0].reasons).toEqual([])
  })
})
