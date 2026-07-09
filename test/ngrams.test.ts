import { describe, expect, it } from 'vitest'
import { ngramRollup, parseNgramSizes, type TermRow } from '../src/commands/terms.js'

const t = (term: string, cost: number, conv = 0, clicks = 0): TermRow => ({ term, costMicros: cost * 1e6, conversions: conv, clicks })

describe('ngramRollup', () => {
  const rows = [
    t('free crm software', 100, 0),
    t('free crm tool', 50, 0),
    t('best crm software', 200, 3),
  ]

  it('sums a gram cost across every term that contains it, counts distinct terms', () => {
    const grams = ngramRollup(rows, [1])
    const free = grams.find(g => g.gram === 'free')!
    expect(free.costMicros).toBe(150e6) // 100 + 50
    expect(free.terms).toBe(2)
    const crm = grams.find(g => g.gram === 'crm')!
    expect(crm.costMicros).toBe(350e6) // all three
    expect(crm.terms).toBe(3)
  })

  it('handles 2-grams', () => {
    const grams = ngramRollup(rows, [2])
    const freeCrm = grams.find(g => g.gram === 'free crm')!
    expect(freeCrm.terms).toBe(2)
    expect(freeCrm.costMicros).toBe(150e6)
    expect(grams.find(g => g.gram === 'crm software')!.conversions).toBe(3)
  })

  it('sorts by cost desc and dedupes repeated grams within a term', () => {
    const grams = ngramRollup([t('shoes shoes shoes', 90)], [1])
    expect(grams).toHaveLength(1)
    expect(grams[0].terms).toBe(1) // counted once despite 3 occurrences
    expect(grams[0].costMicros).toBe(90e6)
  })

  it('is sorted by cost descending', () => {
    const grams = ngramRollup(rows, [1])
    for (let i = 1; i < grams.length; i++) expect(grams[i - 1].costMicros).toBeGreaterThanOrEqual(grams[i].costMicros)
  })
})

describe('parseNgramSizes', () => {
  it('parses and dedupes valid sizes', () => {
    expect(parseNgramSizes('1,2,3')).toEqual([1, 2, 3])
    expect(parseNgramSizes('2, 2, 1')).toEqual([2, 1])
  })
  it('rejects junk and out-of-range', () => {
    expect(() => parseNgramSizes('abc')).toThrowError(/1 to 5/)
    expect(() => parseNgramSizes('0,9')).toThrowError()
  })
})
