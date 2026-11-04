export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  const {startBackgroundJobWorker} = await import('./src/lib/server/backgroundJobs/service')
  startBackgroundJobWorker()
  const {startAutomationWalletWorker} = await import('./src/lib/server/automationWallets')
  try { startAutomationWalletWorker() } catch { console.error('Dedicated automation is unavailable. Check private storage configuration.') }
}
