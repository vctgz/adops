import { describe, expect, it } from 'vitest'
import { addDays, dollarsToMicros, isoDate, pct, usd } from '../src/core/money.js'

describe('usd', () => {
  it('formats micros with cents', () => {
    expect(usd(412_900_000)).toBe('$412.90')
  })
  it('formats large values without cents when dp=0', () => {
    expect(usd(31_204_000_000, 0)).toBe('$31,204')
  })
  it('handles negatives', () => {
    expect(usd(-1_500_000)).toBe('-$1.50')
  })
})

describe('dollarsToMicros', () => {
  it('round-trips strings', () => {
    expect(dollarsToMicros('412.90')).toBe(412_900_000)
  })
})

describe('pct', () => {
  it('rounds to whole percent', () => {
    expect(pct(1.0182)).toBe('102%')
  })
})

describe('dates', () => {
  it('isoDate and addDays', () => {
    const d = new Date('2026-07-19T12:00:00Z')
    expect(isoDate(d)).toBe('2026-07-19')
    expect(isoDate(addDays(d, -8))).toBe('2026-07-11')
  })
})
