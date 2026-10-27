const KEY = 'vanity-buy-presets-v1'
export const DEFAULT_BUY_PRESETS = [0, 0.05, 0.1, 0.25] as const
interface PresetStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
function plainAmounts(values: number[]): string {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'number' || !Number.isFinite(value) || Number(value.toFixed(9)) !== value)) throw new Error('Use SOL amounts with no more than 9 decimal places.')
  return values.map(value => value.toFixed(9).replace(/\.?0+$/, '') || '0').join(',')
}
export function formatBuyPresets(values: number[]): string { return plainAmounts(values).replace(/,/g, ', ') }
export function parseBuyPresets(text: string): number[] {
  const pieces = text.split(',').map(value => value.trim())
  if (pieces.length < 1 || pieces.length > 6 || pieces.some(value => !/^\d+(\.\d{1,9})?$/.test(value))) throw new Error('Use 1–6 comma-separated SOL amounts, with up to 9 decimal places.')
  const values = pieces.map(Number)
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1000) || new Set(values).size !== values.length) throw new Error('Use different SOL amounts between 0 and 1,000.')
  return values
}
export function loadBuyPresets(storage: PresetStorage = localStorage): number[] {
  const raw = storage.getItem(KEY)
  if (raw === null) return [...DEFAULT_BUY_PRESETS]
  try {
    if (raw.length > 300) throw new Error()
    const values: unknown = JSON.parse(raw)
    if (!Array.isArray(values) || values.some(value => typeof value !== 'number')) throw new Error()
    return parseBuyPresets(plainAmounts(values))
  } catch { throw new Error('Saved amount presets could not be read. Reset them to use the defaults.') }
}
export function saveBuyPresets(values: number[], storage: PresetStorage = localStorage): number[] {
  const safe = parseBuyPresets(plainAmounts(values))
  storage.setItem(KEY, JSON.stringify(safe))
  return safe
}
