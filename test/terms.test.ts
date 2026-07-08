import { describe, expect, it } from 'vitest'
import { filterTerms } from '../src/commands/terms.js'

const rows = [
  { term: 'cheap', costMicros: 10_000_000, clicks: 5, conversions: 0 },
  { term: 'converter', costMicros: 300_000_000, clicks: 100, conversions: 4 },
  { term: 'waste', costMicros: 412_900_000, clicks: 310, conversions: 0 },
]

describe('filterTerms', () => {
  it('filters by min cost (dollars) and max conversions, sorts by cost desc', () => {
    const out = filterTerms(rows, { minCost: 50, conv: 0 })
    expect(out.map(r => r.term)).toEqual(['waste'])
  })
  it('no filters returns all sorted by cost', () => {
    const out = filterTerms(rows, {})
    expect(out.map(r => r.term)).toEqual(['waste', 'converter', 'cheap'])
  })
  it('conv filter is inclusive upper bound', () => {
    const out = filterTerms(rows, { conv: 4 })
    expect(out).toHaveLength(3)
  })
})
