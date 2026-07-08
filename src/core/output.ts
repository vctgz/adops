import pc from 'picocolors'

export interface Table {
  columns: string[]
  rows: Array<Record<string, unknown>>
}

export type Format = 'table' | 'json' | 'csv'

export function formatFromFlags(o: { json?: boolean; csv?: boolean }): Format {
  if (o.json) return 'json'
  if (o.csv) return 'csv'
  return 'table'
}

const cell = (v: unknown): string => (v == null ? '' : String(v))
const numericish = (s: string): boolean => s !== '' && /^-?[$\d][\d,.]*%?$/.test(s)

export function renderTable(t: Table): string {
  const widths = t.columns.map(c => c.length)
  const grid = t.rows.map(r =>
    t.columns.map((c, i) => {
      const s = cell(r[c])
      widths[i] = Math.max(widths[i], s.length)
      return s
    }),
  )
  const rightAlign = t.columns.map((_, i) =>
    grid.length > 0 && grid.every(row => row[i] === '' || numericish(row[i])),
  )
  const pad = (s: string, w: number, right: boolean) =>
    right ? s.padStart(w) : s.padEnd(w)
  const head = t.columns.map((c, i) => pad(c.toUpperCase(), widths[i], rightAlign[i])).join('   ')
  const lines = grid.map(row => row.map((s, i) => pad(s, widths[i], rightAlign[i])).join('   ').trimEnd())
  return [pc.dim(head.trimEnd()), ...lines].join('\n')
}

export function renderCsv(t: Table): string {
  const esc = (v: unknown) => {
    const s = cell(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [t.columns.join(','), ...t.rows.map(r => t.columns.map(c => esc(r[c])).join(','))].join('\n')
}

export function render(t: Table, f: Format): string {
  if (f === 'json') return JSON.stringify(t.rows.map(r => Object.fromEntries(t.columns.map(c => [c, r[c] ?? null]))), null, 2)
  if (f === 'csv') return renderCsv(t)
  return renderTable(t)
}

export function printTable(t: Table, f: Format): void {
  process.stdout.write(render(t, f) + '\n')
}
