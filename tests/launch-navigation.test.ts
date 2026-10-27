import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { prepareLaunchLinkNavigation, prepareLaunchNavigation, setActiveDesignForNavigation } from '../src/lib/launchNavigation'
import { useLaunchStore } from '../src/stores/launchStore'
import { createLaunchDraft, loadLaunchDrafts, saveLaunchDraft } from '../src/lib/launchDrafts'
import { DEFAULT_LAUNCH_CONFIG } from '../src/lib/launchConfig'
import { savePendingWalletOperation } from '../src/lib/walletOperations/history'
import { beginGroupOperation, GROUP_OPERATION_PENDING_KEY } from '../src/lib/walletGroups/history'

let values: Map<string,string>
beforeEach(()=>{
  values=new Map()
  vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}})
  vi.stubGlobal('window',{dispatchEvent:()=>true})
  useLaunchStore.getState().reset()
  setActiveDesignForNavigation(undefined)
})
afterEach(()=>vi.unstubAllGlobals())
const receipt=()=>({mode:'standard' as const,venue:'pump' as const,mint:Keypair.generate().publicKey.toBase58(),signatures:[bs58.encode(new Uint8Array(64).fill(1))],confirmedAt:'2026-10-27T10:00:00.000Z'})

describe('launch link clicks',()=>{
  const click=(overrides:Partial<Parameters<typeof prepareLaunchLinkNavigation>[0]>={})=>({button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,defaultPrevented:false,preventDefault:vi.fn(),...overrides})
  it('cancels navigation when unfinished artwork cannot be preserved',()=>{
    const store=useLaunchStore.getState(),artwork=new Blob(['unsaved'],{type:'image/png'}),event=click()
    store.setMetadata({name:'Keep this design',symbol:'KEEP',description:'Do not navigate away'});store.setImageFile(artwork)
    expect(prepareLaunchLinkNavigation(event,'/launch?new=1')).toBe(false)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(useLaunchStore.getState().metadata?.description).toBe('Do not navigate away')
    expect(useLaunchStore.getState().imageFile).toBe(artwork)
    expect(loadLaunchDrafts()).toEqual([])
  })
  it('allows the next page only after preserving the current public design',()=>{
    const event=click()
    useLaunchStore.getState().setMetadata({name:'Save before leaving',symbol:'SAVE',description:'Keep my story'})
    expect(prepareLaunchLinkNavigation(event,'/launch?new=1')).toBe(true)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(loadLaunchDrafts()[0].metadata.description).toBe('Keep my story')
    expect(useLaunchStore.getState().metadata).toBeNull()
  })
  it.each([{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}])('preserves this tab when browser handles a modified click %j',overrides=>{
    const event=click(overrides)
    useLaunchStore.getState().setMetadata({name:'Still editing here',symbol:'HERE',description:''})
    prepareLaunchLinkNavigation(event,'/launch?new=1')
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(useLaunchStore.getState().metadata?.name).toBe('Still editing here')
    expect(loadLaunchDrafts()).toEqual([])
  })
})

describe('new launch navigation preserves unfinished designs',()=>{
  it('saves the current public design before clearing its mint for an explicit new launch',()=>{
    const store=useLaunchStore.getState(),mint=Keypair.generate()
    store.setMetadata({name:'Do not lose',symbol:'KEEP',description:'My pending story'});store.setMintKeypair(mint);store.setStep('select-mint')
    prepareLaunchNavigation('/launch?new=1')
    expect(useLaunchStore.getState().metadata).toBeNull()
    expect(useLaunchStore.getState().mintSecretKey).toBeNull()
    expect(loadLaunchDrafts()[0].metadata.description).toBe('My pending story')
    expect(JSON.stringify(loadLaunchDrafts())).not.toMatch(/secretKey|mintSecretKey/)
  })
  it('updates the active kit while preserving its public artwork reference',()=>{
    const draft=createLaunchDraft({name:'Active kit',metadata:{name:'Old',symbol:'OLD',description:''},metadataUri:'',config:{...DEFAULT_LAUNCH_CONFIG},artworkId:'a'.repeat(64)})
    saveLaunchDraft(draft);localStorage.setItem('vanity-active-design-v1',draft.id)
    setActiveDesignForNavigation(draft.id)
    useLaunchStore.getState().setMetadata({name:'Revised',symbol:'NEW',description:'Updated story'})
    prepareLaunchNavigation('/launch?new=1')
    const saved=loadLaunchDrafts()
    expect(saved).toHaveLength(1);expect(saved[0].id).toBe(draft.id);expect(saved[0].artworkId).toBe('a'.repeat(64));expect(saved[0].metadata.name).toBe('Revised')
  })
  it('does not overwrite another tab’s active kit when no per-tab design identity is registered',()=>{
    const other=createLaunchDraft({name:'Other tab',metadata:{name:'Other token',symbol:'OTHER',description:'Keep this design'},metadataUri:'',config:{...DEFAULT_LAUNCH_CONFIG}})
    saveLaunchDraft(other);localStorage.setItem('vanity-active-design-v1',other.id)
    useLaunchStore.getState().setMetadata({name:'This tab',symbol:'THIS',description:'Preserve me separately'})
    prepareLaunchNavigation('/launch?new=1')
    const drafts=loadLaunchDrafts()
    expect(drafts).toHaveLength(2)
    expect(drafts.find(value=>value.id===other.id)?.metadata.description).toBe('Keep this design')
    expect(drafts.find(value=>value.id!==other.id)?.metadata.description).toBe('Preserve me separately')
  })
  it('preserves the current design when its artwork is not yet safely stored or browser storage fails',()=>{
    const store=useLaunchStore.getState(),blob=new Blob(['unsaved'],{type:'image/png'})
    store.setMetadata({name:'Unsaved artwork',symbol:'ART',description:''});store.setImageFile(blob)
    prepareLaunchNavigation('/launch?new=1')
    expect(useLaunchStore.getState().imageFile).toBe(blob)
    expect(useLaunchStore.getState().error).toMatch(/save.*design|artwork/i)
    store.setImageFile(null)
    vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('Storage blocked')},setItem:()=>{throw new Error('Storage blocked')}})
    prepareLaunchNavigation('/launch?new=1')
    expect(useLaunchStore.getState().metadata?.name).toBe('Unsaved artwork')
  })
  it('preserves a confirmed receipt during pending wallet operations or active signing',()=>{
    const saved=receipt(),store=useLaunchStore.getState();store.setReceipt(saved);store.setStep('result')
    savePendingWalletOperation({kind:'sol',payer:Keypair.generate().publicKey.toBase58(),priorityLamports:'0',recipients:[{address:Keypair.generate().publicKey.toBase58(),rawAmount:'10000000'}],signature:bs58.encode(new Uint8Array(64).fill(2)),blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100,submittedAt:'2026-10-27T10:00:00.000Z'})
    prepareLaunchNavigation('/launch?new=1')
    expect(useLaunchStore.getState().receipt).toEqual(saved)
    values.clear();store.setIsLoading(true)
    prepareLaunchNavigation('/launch?new=1')
    expect(useLaunchStore.getState().receipt).toEqual(saved)
  })
  it.each(['launch','trade','bundle'])('preserves the confirmed receipt when a %s recovery record exists',kind=>{
    const saved=receipt(),store=useLaunchStore.getState();store.setReceipt(saved);store.setStep('result')
    if(kind==='launch')localStorage.setItem('vanity-pending-launch',JSON.stringify({...saved,payer:Keypair.generate().publicKey.toBase58(),blockhash:Keypair.generate().publicKey.toBase58(),submittedAt:saved.confirmedAt}))
    if(kind==='trade')localStorage.setItem('vanity-trade-pending',JSON.stringify({action:'buy',mint:saved.mint,payer:Keypair.generate().publicKey.toBase58(),signature:saved.signatures[0],blockhash:Keypair.generate().publicKey.toBase58(),submittedAt:saved.confirmedAt,maxBuyLamports:'1',maxSellRaw:'0'}))
    if(kind==='bundle')localStorage.setItem('vanity-bundle-pending-v1',JSON.stringify({version:1,receipt:{success:false,status:'unknown',mintAddress:saved.mint,createSignature:saved.signatures[0],submittedSignatures:saved.signatures}}))
    expect(prepareLaunchNavigation('/launch?new=1')).toBe(false)
    expect(useLaunchStore.getState().receipt).toEqual(saved)
    expect(useLaunchStore.getState().currentStep).toBe('result')
  })
  it('preserves a confirmed receipt and an in-progress design while a group operation needs recovery',()=>{
    const saved=receipt(),store=useLaunchStore.getState(),mint=Keypair.generate()
    beginGroupOperation({version:1,id:crypto.randomUUID(),kind:'fund',groupName:'Launch team',createdAt:saved.confirmedAt,updatedAt:saved.confirmedAt,status:'running',packets:[{index:0,intent:{kind:'sol',payer:Keypair.generate().publicKey.toBase58(),priorityLamports:'0',recipients:[{address:Keypair.generate().publicKey.toBase58(),rawAmount:'1000000'}]},payerBeforeLamports:'1005000',payerAfterLamports:'0',networkFeeLamports:'5000',status:'ready'}],skipped:[],summary:{walletCount:1,transactionCount:1,platformFeeLamports:'0',totalTransferLamports:'1000000',totalNetworkFeeLamports:'5000',reserveLamports:'0'}})
    const pending=localStorage.getItem(GROUP_OPERATION_PENDING_KEY)
    store.setReceipt(saved);store.setStep('result')
    expect(prepareLaunchNavigation('/launch?new=1')).toBe(false)
    expect(useLaunchStore.getState().receipt).toEqual(saved)
    expect(useLaunchStore.getState().currentStep).toBe('result')
    expect(useLaunchStore.getState().error).toMatch(/group operation.*confirmation/i)
    store.setMetadata({name:'Preserved project',symbol:'KEEP',description:'Unfinished token'});store.setMintKeypair(mint);store.setStep('select-mint')
    expect(prepareLaunchNavigation('/launch?new=1')).toBe(false)
    expect(useLaunchStore.getState().metadata?.name).toBe('Preserved project')
    expect(useLaunchStore.getState().getMintKeypair()?.publicKey.toBase58()).toBe(mint.publicKey.toBase58())
    expect(loadLaunchDrafts()).toEqual([])
    expect(localStorage.getItem(GROUP_OPERATION_PENDING_KEY)).toBe(pending)
  })
  it('fails closed without replacing a malformed group recovery record or the current project',()=>{
    const store=useLaunchStore.getState(),mint=Keypair.generate()
    store.setMetadata({name:'Keep my work',symbol:'KEEP',description:''});store.setMintKeypair(mint);store.setStep('select-mint')
    localStorage.setItem(GROUP_OPERATION_PENDING_KEY,'{interrupted recovery record')
    expect(prepareLaunchNavigation('/launch?new=1')).toBe(false)
    expect(useLaunchStore.getState().metadata?.name).toBe('Keep my work')
    expect(useLaunchStore.getState().getMintKeypair()?.publicKey.toBase58()).toBe(mint.publicKey.toBase58())
    expect(useLaunchStore.getState().error).toMatch(/group recovery data cannot be read/i)
    expect(localStorage.getItem(GROUP_OPERATION_PENDING_KEY)).toBe('{interrupted recovery record')
    expect(loadLaunchDrafts()).toEqual([])
  })
  it('keeps generic launch navigation intact and starts a fresh design from a completed result only on request',()=>{
    const saved=receipt(),store=useLaunchStore.getState();store.setReceipt(saved);store.setStep('result')
    prepareLaunchNavigation('/launch')
    expect(useLaunchStore.getState().receipt).toEqual(saved)
    prepareLaunchNavigation('/launch?new=1')
    expect(useLaunchStore.getState().receipt).toBeNull();expect(useLaunchStore.getState().currentStep).toBe('metadata')
  })
})
