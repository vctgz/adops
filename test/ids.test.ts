import { describe, expect, it } from 'vitest'
import { assertComposite, parseIds } from '../src/core/ids.js'

describe('parseIds', () => {
  it('splits on commas and whitespace, trims, drops empties', () => {
    expect(parseIds('123, 456   789')).toEqual(['123', '456', '789'])
    expect(parseIds('  42 ')).toEqual(['42'])
    expect(parseIds(undefined)).toEqual([])
    expect(parseIds('')).toEqual([])
  })
})

describe('assertComposite', () => {
  it('accepts adGroupId~criterionId', () => {
    expect(assertComposite('123~456')).toBe('123~456')
  })
  it('rejects a plain id with a helpful message', () => {
    expect(() => assertComposite('123')).toThrowError(/adGroupId~criterionId/)
  })
})
