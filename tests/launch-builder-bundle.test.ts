import {beforeEach,describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {useLaunchStore} from '../src/stores/launchStore'
import {LAUNCH_STEP_ORDER,savedLaunchUrl} from '../src/lib/launchFlow'
import {createLaunchDraft,restoreLaunchDraft} from '../src/lib/launchDrafts'
import {DEFAULT_LAUNCH_CONFIG} from '../src/lib/launchConfig'
import {publicPending} from '../src/lib/launchHistory'

const settings=()=>({version:1 as const,mode:'organic' as const,groupId:'launch-group',wallets:[{walletId:'buyer-1',publicKey:Keypair.generate().publicKey.toBase58(),name:'Buyer one',buySol:0.02,delaySeconds:4}],intervalMinSeconds:3,intervalMaxSeconds:10})
beforeEach(()=>useLaunchStore.getState().reset())
describe('wallet buys inside the launch builder',()=>{
  it('turns an explicitly new launch into a resumable address after a successful save',()=>{
    expect(savedLaunchUrl('new=1')).toBe('/launch')
    expect(savedLaunchUrl('new=1&mode=standard&venue=pump')).toBe('/launch?mode=standard&venue=pump')
    expect(savedLaunchUrl('draft=abc')).toBeNull()
  })
  it('preserves a bounded public bundle outcome in receipts without retaining signer fields',()=>{
    const bundleExecution={mode:'organic',buyerCount:2,status:'partial',message:'Remaining buys stopped.'}
    const pending=publicPending({mode:'standard',mint:'mint',payer:'payer',blockhash:'hash',signatures:['sig'],submittedAt:'now',bundleExecution,privateKey:'private'} as any)
    expect(pending).toHaveProperty('bundleExecution',bundleExecution)
    expect(JSON.stringify(pending)).not.toMatch(/private/)
    expect(()=>publicPending({...pending,bundleExecution:{...bundleExecution,buyerCount:500}} as any)).toThrow()
  })
  it('places launch settings before signer selection within preparation',()=>{
    expect(LAUNCH_STEP_ORDER).toEqual(['metadata','select-mint','launch-settings','connect-wallet','sign-send','result'])
  })
  it('starts without additional buyers and resets an edited plan for a fresh project',()=>{
    const store=useLaunchStore.getState() as any
    expect(store.bundleSettings).toMatchObject({mode:'manual',wallets:[]})
    store.setBundleSettings(settings())
    expect(useLaunchStore.getState()).toHaveProperty('bundleSettings.mode','organic')
    useLaunchStore.getState().reset()
    expect(useLaunchStore.getState()).toHaveProperty('bundleSettings.wallets',[])
  })
  it('roundtrips public buyer settings with a draft without serializing keys',()=>{
    const bundleSettings=settings()
    const draft=createLaunchDraft({name:'Saved launch',metadata:{name:'Example',symbol:'EX',description:''},metadataUri:'',config:{...DEFAULT_LAUNCH_CONFIG},bundleSettings} as any)
    expect(draft).toHaveProperty('bundleSettings',bundleSettings)
    expect(restoreLaunchDraft(draft)).toHaveProperty('bundleSettings',bundleSettings)
    expect(JSON.stringify(draft)).not.toMatch(/privateKey|secretKey|mintSecretKey/)
  })
  it('restores legacy drafts with an empty manual plan and rejects malformed explicit plans',()=>{
    const input={name:'Legacy',metadata:{name:'Example',symbol:'EX',description:''},metadataUri:'',config:{...DEFAULT_LAUNCH_CONFIG}}
    expect(restoreLaunchDraft(createLaunchDraft(input))).toHaveProperty('bundleSettings.mode','manual')
    expect(()=>createLaunchDraft({...input,bundleSettings:{...settings(),mode:'fake'}} as any)).toThrow()
  })
})
