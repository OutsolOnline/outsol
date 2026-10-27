import { describe, expect, it } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { PENDING_KEY, RECEIPTS_KEY } from '../src/lib/launchHistory'
import { TRADE_HISTORY_KEY, TRADE_PENDING_KEY } from '../src/lib/venues/tradeHistory'
import { filterWorkspaceActivity, readWorkspaceActivity } from '../src/lib/workspaceActivity'
import {WALLET_OPERATION_PENDING_KEY} from '../src/lib/walletOperations/history'
import {BUNDLE_PENDING_KEY,BUNDLE_RECEIPT_KEY} from '../src/lib/bundler/pending'

const mint = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey.toBase58()
const payer = Keypair.fromSeed(new Uint8Array(32).fill(8)).publicKey.toBase58()
const signature = (byte: number) => bs58.encode(new Uint8Array(64).fill(byte))
const storage = (values: Record<string, unknown>) => ({ getItem: (key: string) => key in values ? JSON.stringify(values[key]) : null })
const launch = { mode: 'standard', venue: 'pump', mint, signatures: [signature(1)], confirmedAt: '2026-10-27T10:00:00.000Z' }
const trade = { action: 'sell', mint, payer, signature: signature(2), blockhash: payer, submittedAt: '2026-10-27T11:00:00.000Z', maxBuyLamports: '0', maxSellRaw: '100', status: 'confirmed', resolvedAt: '2026-10-27T11:01:00.000Z' }

describe('public workspace activity', () => {
  it('keeps a complete sixteen-buyer launch visible with its original signatures',()=>{
    const signatures=Array.from({length:19},(_,index)=>signature(index+1))
    const result=readWorkspaceActivity(storage({[RECEIPTS_KEY]:[{...launch,signatures}]}))
    expect(result.warnings).toEqual([])
    expect(result.items).toHaveLength(1)
    expect(result.items[0].signatures).toEqual(signatures)
    expect(readWorkspaceActivity(storage({[RECEIPTS_KEY]:[{...launch,signatures:Array.from({length:21},(_,index)=>signature(index+1))}]})).items).toEqual([])
  })
  it('projects a pending bundle once without inventing a timestamp or returning stored error payloads',()=>{
    const receipt={success:false,status:'unknown',mintAddress:mint,createSignature:signature(11),submittedSignatures:[signature(11),signature(12)],error:'Private-looking caller text is not copied'}
    const result=readWorkspaceActivity(storage({[BUNDLE_RECEIPT_KEY]:{version:0,state:{result:receipt}},[BUNDLE_PENDING_KEY]:{version:1,receipt},[RECEIPTS_KEY]:[launch]}))
    expect(result.warnings).toEqual([])
    expect(result.items.map(item=>item.kind)).toEqual(['launch','bundle'])
    expect(result.items[1]).toMatchObject({kind:'bundle',status:'pending',timestamp:null,mint,signatures:[signature(11),signature(12)]})
    expect(JSON.stringify(result)).not.toMatch(/Private-looking|caller text|error|state|receipt/)
    expect(filterWorkspaceActivity(result.items,'pending','')).toHaveLength(1)
    expect(filterWorkspaceActivity(result.items,'bundles',signature(12))).toHaveLength(1)
  })
  it.each(['confirmed','failed','partial'] as const)('preserves the actual %s bundle status, puts undated rows last, and excludes unsubmitted errors',status=>{
    const receipt={success:status==='confirmed',status,mintAddress:mint,createSignature:signature(21),submittedSignatures:[signature(21)]}
    const result=readWorkspaceActivity(storage({[BUNDLE_RECEIPT_KEY]:{state:{result:receipt}},[TRADE_HISTORY_KEY]:[trade]}))
    expect(result.items.map(item=>item.kind)).toEqual(['trade','bundle'])
    expect(result.items[1]).toMatchObject({kind:'bundle',status,timestamp:null})
    expect(readWorkspaceActivity(storage({[BUNDLE_RECEIPT_KEY]:{state:{result:{success:false,status:'failed',error:'Never submitted'}}}})).items).toEqual([])
  })
  it('warns about invalid or oversized bundle data while preserving valid old activity and never mutating storage',()=>{
    let writes=0
    const source={...storage({[RECEIPTS_KEY]:[launch],[BUNDLE_PENDING_KEY]:{version:1,receipt:{success:false,status:'unknown',mintAddress:mint,submittedSignatures:['invalid'],privateKey:'must not project'}}}),setItem:()=>{writes++},removeItem:()=>{writes++}}
    const result=readWorkspaceActivity(source)
    expect(result.items).toHaveLength(1);expect(result.warnings.join(' ')).toMatch(/bundle/i);expect(writes).toBe(0)
    expect(JSON.stringify(result)).not.toMatch(/privateKey|must not project/)
    const oversized=readWorkspaceActivity({getItem:key=>key===BUNDLE_RECEIPT_KEY?' '.repeat(100001):null})
    expect(oversized.items).toEqual([]);expect(oversized.warnings.join(' ')).toMatch(/bundle/i)
  })
  it('keeps separate actual bundle records in a deterministic undated tail after existing dated rows',()=>{
    const otherMint=Keypair.fromSeed(new Uint8Array(32).fill(19)).publicKey.toBase58()
    const finished={success:true,status:'confirmed',mintAddress:otherMint,submittedSignatures:[signature(30)]}
    const pending={success:false,status:'unknown',mintAddress:mint,submittedSignatures:[signature(31)]}
    const source=storage({[BUNDLE_RECEIPT_KEY]:{state:{result:finished}},[BUNDLE_PENDING_KEY]:{version:1,receipt:pending},[RECEIPTS_KEY]:[launch]})
    const first=readWorkspaceActivity(source),second=readWorkspaceActivity(source)
    expect(first.items.map(item=>item.timestamp)).toEqual([launch.confirmedAt,null,null])
    expect(first.items.slice(1).map(item=>item.status).sort()).toEqual(['confirmed','pending'])
    expect(first.items.map(item=>item.id)).toEqual(second.items.map(item=>item.id))
  })
  it('projects pending wallet transfers and directs them to their own operation kind',()=>{
    const result=readWorkspaceActivity(storage({[WALLET_OPERATION_PENDING_KEY]:{kind:'sol',payer,priorityLamports:'0',recipients:[{address:mint,rawAmount:'1000'}],signature:signature(9),submittedAt:'2026-10-27T12:00:00.000Z',privateKey:'PRIVATE'}}))
    expect(result.items).toMatchObject([{kind:'wallet',status:'pending',mint:payer,description:'SOL distribution awaiting confirmation.'}])
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(filterWorkspaceActivity(result.items,'wallets','')).toHaveLength(1)
    expect(filterWorkspaceActivity(result.items,'launches','')).toHaveLength(0)
  })
  it('projects receipt fields without copying signer, secret, payer or arbitrary error data', () => {
    const result = readWorkspaceActivity(storage({ [RECEIPTS_KEY]: [{ ...launch, secretKey: [99], signer: 'PRIVATE', summary: { secret: 'PRIVATE' } }], [TRADE_HISTORY_KEY]: [{ ...trade, status: 'failed', error: 'PRIVATE', transaction: 'PRIVATE' }] }))
    expect(result.items).toHaveLength(2)
    expect(Object.keys(result.items[0]).sort()).toEqual(['description', 'id', 'kind', 'mint', 'signatures', 'status', 'timestamp', 'venue'])
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|secret|payer|blockhash|maxSellRaw|transaction/)
    expect(result.items[0]).toMatchObject({ kind: 'trade', status: 'failed', mint, signatures: [signature(2)] })
    expect(result.warnings).toEqual([])
  })

  it('combines all sources in newest-first order and preserves failed versus pending states', () => {
    const result = readWorkspaceActivity(storage({ [RECEIPTS_KEY]: [launch], [TRADE_HISTORY_KEY]: [trade], [PENDING_KEY]: { ...launch, confirmedAt: undefined, submittedAt: '2026-10-27T12:00:00.000Z', phase: 'launch', signatures: [signature(3)] }, [TRADE_PENDING_KEY]: { ...trade, status: undefined, resolvedAt: undefined, submittedAt: '2026-10-27T13:00:00.000Z', signature: signature(4) } }))
    expect(result.items.map(item => [item.kind, item.status, item.timestamp])).toEqual([
      ['trade', 'pending', '2026-10-27T13:00:00.000Z'], ['launch', 'pending', '2026-10-27T12:00:00.000Z'],
      ['trade', 'confirmed', '2026-10-27T11:01:00.000Z'], ['launch', 'confirmed', '2026-10-27T10:00:00.000Z'],
    ])
    expect(filterWorkspaceActivity(result.items, 'pending', '')).toHaveLength(2)
    expect(filterWorkspaceActivity(result.items, 'trades', 'SELL')).toHaveLength(2)
    expect(filterWorkspaceActivity(result.items, 'launches', mint)).toHaveLength(2)
  })

  it('keeps valid entries and reports malformed, oversized and unavailable sources separately', () => {
    const result = readWorkspaceActivity({ getItem: key => {
      if (key === RECEIPTS_KEY) return JSON.stringify([launch, { ...launch, mint: 'https://evil.example' }])
      if (key === TRADE_HISTORY_KEY) return '{'
      if (key === PENDING_KEY) return ' '.repeat(300_000)
      if (key === TRADE_PENDING_KEY) throw new Error('Storage denied')
      return null
    } })
    expect(result.items).toHaveLength(1)
    expect(result.warnings).toHaveLength(4)
    expect(result.warnings.join(' ')).toMatch(/Launch history/)
    expect(result.warnings.join(' ')).toMatch(/Trade history/)
    expect(result.warnings.join(' ')).toMatch(/Pending launch/)
    expect(result.warnings.join(' ')).toMatch(/Pending trade/)
  })

  it('labels a pending lookup as setup and never projects it as a completed launch', () => {
    const result = readWorkspaceActivity(storage({ [PENDING_KEY]: { ...launch, submittedAt: '2026-10-27T12:00:00.000Z', phase: 'lookup', lookupTableAddress: payer } }))
    expect(result.items[0]).toMatchObject({ kind: 'setup', status: 'pending', description: expect.stringMatching(/setup.*confirmation/i) })
    expect(filterWorkspaceActivity(result.items, 'pending', '')).toHaveLength(1)
    expect(result.items.some(item => item.kind === 'launch' && item.status === 'confirmed')).toBe(false)
  })

  it('rejects malformed explorer identifiers and invalid dates instead of exposing links', () => {
    const result = readWorkspaceActivity(storage({ [RECEIPTS_KEY]: [{ ...launch, signatures: ['javascript:alert(1)'] }, { ...launch, confirmedAt: 'invalid' }, { ...launch, mint: signature(2) }] }))
    expect(result.items).toEqual([])
    expect(result.warnings).toHaveLength(1)
  })

  it('returns a truthful empty state when there is no saved activity', () => {
    expect(readWorkspaceActivity(storage({}))).toEqual({ items: [], warnings: [] })
  })
})
