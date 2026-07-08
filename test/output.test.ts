import { describe, expect, it } from 'vitest'
import { render, renderCsv, renderTable } from '../src/core/output.js'

const t = {
  columns: ['name', 'cost'],
  rows: [
    { name: 'free ads course', cost: '$412.90' },
    { name: 'a,b "quoted"', cost: '$1.00' },
  ],
}

describe('renderTable', () => {
  it('pads columns and right-aligns numeric-ish cells', () => {
    const out = renderTable(t)
    const lines = out.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('free ads course')
    // cost column right-aligned: $1.00 is padded left
    expect(lines[2]).toMatch(/ {2,}\$1\.00$/)
  })
  it('left-aligns text columns', () => {
    const out = renderTable(t)
    expect(out.split('\n')[1].startsWith('free ads course')).toBe(true)
  })
})

describe('renderCsv', () => {
  it('quotes fields containing commas and quotes', () => {
    const csv = renderCsv(t)
    expect(csv.split('\n')[0]).toBe('name,cost')
    expect(csv).toContain('"a,b ""quoted"""')
  })
})

describe('render json', () => {
  it('emits rows as objects', () => {
    const parsed = JSON.parse(render(t, 'json'))
    expect(parsed).toHaveLength(2)
    expect(parsed[0].name).toBe('free ads course')
  })
})
