import { validateLaunchConfig, type LaunchConfig } from './launchConfig'

/** New creation is Pump-only. Legacy receipts and low-level builders remain readable. */
export function validatePumpCreation(config: LaunchConfig): string[] {
  if (config.mode !== 'standard' || config.venue !== 'pump') return ['New launches use Pump.fun. Start a Pump.fun design and review its settings.']
  const errors = validateLaunchConfig(config)
  if (Number.isFinite(config.priorityFeeSol) && config.priorityFeeSol > 0.01) errors.push('Pump.fun priority fee must be between 0 and 0.01 SOL.')
  return errors
}
export function normalizePumpDesign(config: LaunchConfig): LaunchConfig {
  return { ...config, mode: 'standard', venue: 'pump', devBuySol: config.mode === 'standard' && config.venue === 'pump' ? config.devBuySol : 0 }
}
