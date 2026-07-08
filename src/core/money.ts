/** Money is integer micros internally, formatted only at the edge. */
export const usd = (micros: number, dp = 2): string => {
  const sign = micros < 0 ? '-' : ''
  return `${sign}$${Math.abs(micros / 1e6).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`
}

export const dollarsToMicros = (d: string | number): number => Math.round(Number(d) * 1e6)

export const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10)

export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000)
