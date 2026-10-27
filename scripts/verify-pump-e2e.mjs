import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Repeatable evidence, with no mainnet broadcast path. Local execution additionally
// verifies Surfpool identity and permits only fresh, fake-funded test payers.
const mode = process.argv[2] ?? 'local'
if (!['local', 'mainnet-readonly'].includes(mode)) throw new Error('Use: node scripts/verify-pump-e2e.mjs [local|mainnet-readonly]')
const startedAt = new Date().toISOString()
const directory = resolve(process.env.VANITY_E2E_OUTPUT_DIR ?? `work/pump-e2e-${mode}-${Date.now()}`)
mkdirSync(directory, { recursive: true })
const environment = { ...process.env }
for (const name of ['RUN_NATIVE_PUMP_SIMULATION', 'RUN_LAUNCHLAB_SIMULATION', 'RUN_METEORA_SIMULATION', 'RUN_DIRECT_LAUNCH_RPC', 'RUN_DIRECT_LAUNCH_SIMULATION', 'RUN_MANAGE_TRADE_SIMULATION', 'RUN_PUMP_LOCALNET']) delete environment[name]
environment[mode === 'local' ? 'RUN_PUMP_LOCALNET' : 'RUN_NATIVE_PUMP_SIMULATION'] = '1'
environment.VANITY_LIVE_EVIDENCE_FILE = resolve(directory, 'checks.ndjson')
writeFileSync(environment.VANITY_LIVE_EVIDENCE_FILE, '')
if (mode === 'mainnet-readonly' && !environment.VANITY_TEST_RPC_URL && !environment.RPC_URL) {
  const configured = readFileSync('.env.local', 'utf8').match(/^\s*RPC_URL\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '')
  if (!configured) throw new Error('Configure an RPC with complete-bank simulateBundle support; explicit verification never skips unsupported providers')
  environment.RPC_URL = configured
}
const secrets = [environment.RPC_URL, environment.VANITY_TEST_RPC_URL].filter(Boolean)
const sanitize = text => secrets.reduce((result, secret) => result.replaceAll(secret, '[RPC endpoint suppressed]'), text)
const reportPath = resolve(directory, 'vitest.json')
const child = spawn(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', mode === 'local' ? 'tests/pump-localnet.live.test.ts' : 'tests/venues-mainnet.live.test.ts', '--maxWorkers=1', '--no-file-parallelism', '--reporter=json', `--outputFile=${reportPath}`], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = '', stderr = ''
child.stdout.on('data', chunk => { stdout += chunk.toString() })
child.stderr.on('data', chunk => { stderr += chunk.toString() })
const exitCode = await new Promise((complete, reject) => { child.on('error', reject); child.on('close', complete) })
let report
try { const safeReport = sanitize(readFileSync(reportPath, 'utf8')); writeFileSync(reportPath, safeReport); report = JSON.parse(safeReport) } catch { report = { success: false, numPassedTests: 0, numFailedTests: 0 } }
const checks = readFileSync(environment.VANITY_LIVE_EVIDENCE_FILE, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
const requiredChecks = mode === 'local' ? 17 : 2
const requiredTests = mode === 'local' ? 12 : 2
const success = exitCode === 0 && report.success === true && report.numPassedTests >= requiredTests && checks.length >= requiredChecks
const summary = { mode, startedAt, finishedAt: new Date().toISOString(), success, processExitCode: exitCode, passedTests: report.numPassedTests, failedTests: report.numFailedTests, evidenceRecords: checks.length, realSolSpent: false, broadcastToMainnet: false, limits: mode === 'local' ? ['Local Surfpool execution does not prove external Jito relay acceptance or mainnet landing.'] : ['Unsigned mainnet bank simulation does not prove wallet signing or funded landing.'], checks }
writeFileSync(resolve(directory, 'result.json'), JSON.stringify(summary, null, 2) + '\n')
writeFileSync(resolve(directory, 'run.log'), sanitize(stdout + stderr))
console.log(JSON.stringify({ ...summary, checks: undefined, evidenceDirectory: directory }))
if (!success) {
  console.error(sanitize(stderr || stdout).slice(-12_000))
  process.exitCode = 1
}
