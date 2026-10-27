'use client'

import { create } from 'zustand'
import {persist,createJSONStorage} from 'zustand/middleware'
import {Connection} from '@solana/web3.js'
import {getRpcEndpoint} from '@/lib/rpc'
import {reconcileBundleReceipt,settleMatchingLaunchPending} from '@/lib/bundler/reconcile'
import {publicBundleReceipt} from '@/lib/bundler/receipt'
import { BundleWallet, BundlerConfig, BundleResult, BundleMode, WalletMode, MintMode, SniperMode, SellTriggerType, MAX_BUNDLE_WALLETS, DEFAULT_JITO_TIP } from '@/lib/bundler/types'
import { validatePrivateKey, getBalance, executeBundleLaunch } from '@/lib/bundler/api'
import { readPending } from '@/lib/launchHistory'
import { readTradePending } from '@/lib/venues/tradeHistory'
import { assertNoPendingWalletOperation } from '@/lib/walletOperations/history'
import { BUNDLE_RECEIPT_KEY, assertNoPendingBundleReceipt, guardedBundleReceiptStorage, persistBundleCheckpoint, readPendingBundleReceipt } from '@/lib/bundler/pending'
import {assertNoPendingGroupOperation} from '@/lib/walletGroups/history'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {createManagedBundleSource,type BundleSigners} from '@/lib/bundler/managedSource'
import {applyBundleSettings,type BundleSettings} from '@/lib/bundler/presets'
import {type CreatorFeeSelection} from '@/lib/creatorFeeRouting'
import {verifyCreatorFeeRoutingOnChain} from '@/lib/creatorFeeRecovery'

interface BundlerStore extends BundlerConfig {
  // Status
  isExecuting: boolean
  statusMessage: string
  result: BundleResult | null
  
  // Actions - Token info
  setTokenName: (name: string) => void
  setTokenSymbol: (symbol: string) => void
  setTokenDescription: (desc: string) => void
  setTokenImage: (file: File | null) => void
  setTokenBanner: (file: File | null) => void
  
  // Actions - Creator wallet
  setCreatorPrivateKey: (key: string) => void
  setDevBuyAmount: (amount: number) => void
  setCreatorFeeSelection:(value:CreatorFeeSelection)=>void
  selectManagedGroup:(groupId:string,creatorId?:string)=>void
  useManualWallets:()=>void
  applyPreset:(settings:BundleSettings)=>void
  
  // Actions - Mint keypair
  setMintMode: (mode: MintMode) => void
  setImportedMintKey: (key: string) => void
  setVanityPattern: (pattern: string) => void
  setVanityMode: (mode: 'prefix' | 'suffix' | 'contains') => void
  setFoundVanity: (secretKey: string, publicKey: string) => void
  clearFoundVanity: () => void
  
  // Actions - Bundle wallets
  setBundleWalletPrivateKey: (index: number, key: string) => void
  setBundleWalletBuyAmount: (index: number, amount: number) => void
  setBundleWalletMode: (index: number, mode: WalletMode) => void
  setBundleWalletDelay: (index: number, seconds: number) => void
  setBundleWalletSellEnabled: (index: number, enabled: boolean) => void
  setBundleWalletSellPercent: (index: number, percent: number) => void
  setBundleWalletSellTriggerType: (index: number, type: SellTriggerType) => void
  setBundleWalletSellDelay: (index: number, seconds: number) => void
  setBundleWalletSellProfitMultiplier: (index: number, multiplier: number) => void
  importBulkPrivateKeys: (keys: string) => void
  clearBundleWallets: () => void
  
  // Actions - Mode
  setBundleMode: (mode: BundleMode) => void
  setNaturalDelayMin: (seconds: number) => void
  setNaturalDelayMax: (seconds: number) => void
  
  // Actions - Settings
  setJitoTip: (tip: number) => void
  setSlippage: (slippage: number) => void
  setSniperMode: (mode: SniperMode) => void
  setAutoSellEnabled: (enabled: boolean) => void
  setAutoSellTriggerType: (type: SellTriggerType) => void
  setAutoSellDelay: (delay: number) => void
  setAutoSellProfitMultiplier: (multiplier: number) => void
  setAutoSellPercent: (percent: number) => void
  setTwitter: (url: string) => void
  setTelegram: (url: string) => void
  setWebsite: (url: string) => void
  
  // Actions - Execution
  refreshBalances: () => Promise<void>
  executeLaunch: () => Promise<void>
  reset: () => void
  cancelPendingActions:()=>void
  reconcileResult:()=>Promise<void>
}

const createEmptyWallets = (): BundleWallet[] => {
  return Array.from({ length: MAX_BUNDLE_WALLETS }, (_, i) => ({
    id: i + 1,
    privateKey: '',
    publicKey: null,
    balance: null,
    buyAmount: 0,
    mode: 'sniper' as WalletMode,
    delaySeconds: 5,
    isValid: false,
    sellEnabled: false,
    sellPercent: 100,
    sellTriggerType: 'time' as SellTriggerType,
    sellDelaySeconds: 60,
    sellProfitMultiplier: 2, // Default to 2x
  }))
}

const initialState: Omit<BundlerConfig, 'bundleWallets'> & { bundleWallets: BundleWallet[] } = {
  tokenName: '',
  tokenSymbol: '',
  tokenDescription: '',
  tokenImage: null,
  tokenBanner: null,
  creatorPrivateKey: '',
  creatorPublicKey: null,
  creatorBalance: null,
  devBuyAmount: 0,
  creatorFeeSelection:{kind:'deployer'},
  // Default to random - just generate any random mint address
  mintMode: 'random',
  importedMintKey: '',
  importedMintPublicKey: null,
  vanityPattern: 'pump',
  vanityMode: 'suffix',
  foundVanityKey: null,
  foundVanityPublicKey: null,
  bundleWallets: createEmptyWallets(),
  bundleMode: 'sniper',
  naturalDelayMin: 3,
  naturalDelayMax: 10,
  jitoTip: DEFAULT_JITO_TIP,
  slippage: 20,
  sniperMode: 'after_confirm', // Default to safer mode
  autoSellEnabled: false,
  autoSellTriggerType: 'time' as SellTriggerType,
  autoSellDelay: 30,
  autoSellProfitMultiplier: 2, // Default to 2x
  autoSellPercent: 100,
  twitter: '',
  telegram: '',
  website: '',
}

let executionController:AbortController|null=null
export const useBundlerStore = create<BundlerStore>()(persist((set, get) => ({
  ...initialState,
  isExecuting: false,
  statusMessage: '',
  result: null,

  setTokenName: (name) => set({ tokenName: name }),
  setTokenSymbol: (symbol) => set({ tokenSymbol: symbol.toUpperCase() }),
  setTokenDescription: (desc) => set({ tokenDescription: desc }),
  setTokenImage: (file) => set({ tokenImage: file }),
  setTokenBanner: (file) => set({ tokenBanner: file }),

  setMintMode: (mode) => set({ mintMode: mode }),
  
  setImportedMintKey: (key) => {
    const validation = validatePrivateKey(key)
    if (validation.valid && validation.keypair) {
      set({
        importedMintKey: key,
        importedMintPublicKey: validation.keypair.publicKey.toBase58(),
      })
    } else {
      set({
        importedMintKey: key,
        importedMintPublicKey: null,
      })
    }
  },
  
  setVanityPattern: (pattern) => set({ vanityPattern: pattern }),
  setVanityMode: (mode) => set({ vanityMode: mode }),
  
  setFoundVanity: (secretKey, publicKey) => set({
    foundVanityKey: secretKey,
    foundVanityPublicKey: publicKey,
  }),
  
  clearFoundVanity: () => set({
    foundVanityKey: null,
    foundVanityPublicKey: null,
  }),

  setCreatorPrivateKey: (key) => {
    if(get().managedGroupId||get().isExecuting)return
    const validation = validatePrivateKey(key)
    if (validation.valid && validation.keypair) {
      set({
        creatorPrivateKey: key,
        creatorPublicKey: validation.keypair.publicKey.toBase58(),
      })
      // Fetch balance
      getBalance(validation.keypair.publicKey.toBase58()).then(balance => {
        if(get().creatorPrivateKey===key) set({ creatorBalance: balance })
      }).catch(()=>{if(get().creatorPrivateKey===key)set({creatorBalance:null})})
    } else {
      set({
        creatorPrivateKey: key,
        creatorPublicKey: null,
        creatorBalance: null,
      })
    }
  },

  setDevBuyAmount: (amount) => set({ devBuyAmount: amount }),
  setCreatorFeeSelection:value=>{
    if(get().isExecuting||get().result?.createSignature)return
    // The controlled editor can hold an incomplete wallet/login while typing;
    // strict parsing runs before construction and never resets invalid intent.
    set({creatorFeeSelection:value,statusMessage:'',result:null})
  },
  selectManagedGroup:(groupId,creatorId)=>{
    if(get().isExecuting||get().result?.createSignature)return
    const library=useWalletLibraryStore.getState(),group=library.groups.find(value=>value.id===groupId)
    if(!group||!group.walletIds.length||library.storageUnavailable){set({statusMessage:'Choose a populated wallet group from the wallet library.'});return}
    const creator=library.wallets.find(wallet=>wallet.id===(creatorId??group.walletIds[0]))
    if(!creator||!group.walletIds.includes(creator.id)){set({statusMessage:'Choose a creator from this group.'});return}
    const buyers=group.walletIds.filter(id=>id!==creator.id).slice(0,MAX_BUNDLE_WALLETS)
    const current=get().bundleWallets
    const bundleWallets=createEmptyWallets().map((wallet,index)=>{
      const summary=library.wallets.find(value=>value.id===buyers[index])
      return {...wallet,...(current[index]?{buyAmount:current[index].buyAmount,mode:current[index].mode,delaySeconds:current[index].delaySeconds,sellEnabled:current[index].sellEnabled,sellPercent:current[index].sellPercent,sellDelaySeconds:current[index].sellDelaySeconds}:{}),...(summary?{libraryWalletId:summary.id,publicKey:summary.publicKey,isValid:true}:{buyAmount:0,sellEnabled:false})}
    })
    set({managedGroupId:group.id,managedCreatorWalletId:creator.id,creatorPrivateKey:'',creatorPublicKey:creator.publicKey,creatorBalance:null,bundleWallets,statusMessage:'Managed group selected. Unlock its wallets in Wallets before execution.'})
  },
  useManualWallets:()=>{
    if(get().isExecuting||get().result?.createSignature)return
    set({managedGroupId:undefined,managedCreatorWalletId:undefined,creatorPrivateKey:'',creatorPublicKey:null,creatorBalance:null,bundleWallets:createEmptyWallets(),statusMessage:''})
  },
  applyPreset:settings=>{
    if(get().isExecuting||get().result?.createSignature)return
    try{set({...applyBundleSettings(get(),settings),statusMessage:'Preset applied. Review wallet selection, budgets and timing before launching.'})}
    catch(error){set({statusMessage:error instanceof Error?error.message:'Preset could not be applied.'})}
  },

  setBundleWalletPrivateKey: (index, key) => {
    if(get().managedGroupId||get().isExecuting)return
    const { bundleWallets } = get()
    const newWallets = [...bundleWallets]
    const currentWallet = newWallets[index]
    
    if (key) {
      const validation = validatePrivateKey(key)
      newWallets[index] = {
        ...currentWallet,
        privateKey: key,
        publicKey: validation.keypair?.publicKey.toBase58() || null,
        isValid: validation.valid,
        error: validation.error,
      }
      
      // Fetch balance if valid
      if (validation.valid && validation.keypair) {
        getBalance(validation.keypair.publicKey.toBase58()).then(balance => {
          const { bundleWallets: currentWallets } = get()
          const updatedWallets = [...currentWallets]
          if(updatedWallets[index]?.privateKey!==key) return
          updatedWallets[index] = { ...updatedWallets[index], balance }
          set({ bundleWallets: updatedWallets })
        }).catch(()=>{})
      }
    } else {
      newWallets[index] = {
        ...currentWallet,
        privateKey: '',
        publicKey: null,
        balance: null,
        isValid: false,
        error: undefined,
      }
    }
    
    set({ bundleWallets: newWallets })
  },

  setBundleWalletBuyAmount: (index, amount) => {
    const { bundleWallets } = get()
    const newWallets = [...bundleWallets]
    newWallets[index] = { ...newWallets[index], buyAmount: amount }
    set({ bundleWallets: newWallets })
  },

  setBundleWalletMode: (index, mode) => {
    const { bundleWallets } = get()
    const newWallets = [...bundleWallets]
    newWallets[index] = { ...newWallets[index], mode }
    set({ bundleWallets: newWallets })
  },

  setBundleWalletDelay: (index, seconds) => {
    const { bundleWallets } = get()
    const newWallets = [...bundleWallets]
    newWallets[index] = { ...newWallets[index], delaySeconds: seconds }
    set({ bundleWallets: newWallets })
  },

  setBundleWalletSellEnabled: (index, enabled) => {
    const { bundleWallets } = get()
    const newWallets = [...bundleWallets]
    newWallets[index] = { ...newWallets[index], sellEnabled: enabled }
    set({ bundleWallets: newWallets })
  },

  setBundleWalletSellPercent: (index, percent) => {
    const { bundleWallets } = get()
    const newWallets = [...bundleWallets]
    newWallets[index] = { ...newWallets[index], sellPercent: Math.min(100, Math.max(1, percent)) }
    set({ bundleWallets: newWallets })
  },

  setBundleWalletSellTriggerType: (index, type) => {
    const { bundleWallets } = get()
    const newWallets = [...bundleWallets]
    newWallets[index] = { ...newWallets[index], sellTriggerType: type }
    set({ bundleWallets: newWallets })
  },

  setBundleWalletSellDelay: (index, seconds) => {
    const { bundleWallets } = get()
    const newWallets = [...bundleWallets]
    newWallets[index] = { ...newWallets[index], sellDelaySeconds: seconds }
    set({ bundleWallets: newWallets })
  },

  setBundleWalletSellProfitMultiplier: (index, multiplier) => {
    const { bundleWallets } = get()
    const newWallets = [...bundleWallets]
    newWallets[index] = { ...newWallets[index], sellProfitMultiplier: Math.max(1.1, multiplier) }
    set({ bundleWallets: newWallets })
  },

  importBulkPrivateKeys: (keys) => {
    const lines = keys.split('\n').filter(l => l.trim())
    const { bundleWallets, setBundleWalletPrivateKey } = get()
    
    lines.forEach((key, i) => {
      if (i < bundleWallets.length) {
        setBundleWalletPrivateKey(i, key.trim())
      }
    })
  },

  clearBundleWallets: () => {
    if(get().managedGroupId||get().isExecuting)return
    set({ bundleWallets: createEmptyWallets() })
  },

  setBundleMode: (mode) => set({ bundleMode: mode,...(mode==='natural'?{sniperMode:'after_confirm' as const}:{}) }),
  setNaturalDelayMin: (seconds) => set({ naturalDelayMin: seconds }),
  setNaturalDelayMax: (seconds) => set({ naturalDelayMax: seconds }),

  setJitoTip: (tip) => set({ jitoTip: tip }),
  setSlippage: (slippage) => set({ slippage }),
  setSniperMode: (mode) => set({ sniperMode: mode,...(mode==='block0'?{bundleMode:'sniper' as const}:{}) }),
  setAutoSellEnabled: (enabled) => set({ autoSellEnabled: enabled }),
  setAutoSellTriggerType: (type) => set({ autoSellTriggerType: type }),
  setAutoSellDelay: (delay) => set({ autoSellDelay: delay }),
  setAutoSellProfitMultiplier: (multiplier) => set({ autoSellProfitMultiplier: Math.max(1.1, multiplier) }),
  setAutoSellPercent: (percent) => set({ autoSellPercent: percent }),
  setTwitter: (url) => set({ twitter: url }),
  setTelegram: (url) => set({ telegram: url }),
  setWebsite: (url) => set({ website: url }),

  refreshBalances: async () => {
    const { creatorPublicKey, bundleWallets } = get()
    
    // Refresh creator balance
    if (creatorPublicKey) {
      const balance = await getBalance(creatorPublicKey).catch(()=>null)
      if(get().creatorPublicKey===creatorPublicKey)set({ creatorBalance: balance })
    }
    
    // Refresh bundle wallet balances
    const newWallets = await Promise.all(
      bundleWallets.map(async (wallet) => {
        if (wallet.publicKey) {
          const balance = await getBalance(wallet.publicKey).catch(()=>null)
          return { ...wallet, balance }
        }
        return wallet
      })
    )
    
    if(get().bundleWallets===bundleWallets)set({ bundleWallets: newWallets })
  },

  executeLaunch: async () => {
    const state = get()
    if(state.isExecuting) return
    if(state.result?.createSignature || state.result?.bundleId) {
      set({statusMessage:'A launch receipt already exists. Check its signatures before preparing another launch.'})
      return
    }
    
    // Validation
    if (!state.tokenName || !state.tokenSymbol || !state.tokenImage) {
      set({ statusMessage: 'Missing token info', result: { success: false, error: 'Missing token info' } })
      return
    }
    
    if (!state.creatorPublicKey) {
      set({ statusMessage: 'Invalid creator wallet', result: { success: false, error: 'Invalid creator wallet' } })
      return
    }

    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks) {
      set({ statusMessage: 'Use a current browser with secure cross-tab transaction coordination.', result: { success: false, status: 'failed', error: 'Secure cross-tab transaction coordination is unavailable.' } })
      return
    }

    set({ isExecuting: true, statusMessage: 'Starting...', result: null })
    executionController=new AbortController()
    let unsubscribeLibrary:(()=>void)|undefined

    try {
      // Hold the same lock used by launch, trade and wallet operations until all
      // scheduled buys/sells or their cancellation cleanup have finished.
      await locks.request('vanity-launch-submission', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Another tab is signing or checking a transaction. Finish it there first.')
        if (executionController?.signal.aborted) throw new Error('Pending browser actions cancelled.')
        const unresolved = readPendingBundleReceipt()
        if (unresolved) set({ result: unresolved })
        assertNoPendingBundleReceipt()
        if (readPending() || readTradePending()) throw new Error('A launch or trade is pending confirmation. Check Activity before starting another bundle.')
        assertNoPendingWalletOperation()
        assertNoPendingGroupOperation()
        let resolveSigners:()=>BundleSigners
        if(state.managedGroupId&&state.managedCreatorWalletId){
          const managed=createManagedBundleSource(useWalletLibraryStore.getState,state.managedGroupId,state.managedCreatorWalletId,state.bundleWallets.filter(wallet=>wallet.buyAmount>0).map(wallet=>{
            if(!wallet.libraryWalletId)throw new Error('Every selected managed buyer must belong to the wallet group.')
            return {id:wallet.id,libraryWalletId:wallet.libraryWalletId,publicKey:wallet.publicKey}
          }))
          resolveSigners=()=>{
            if(get().managedGroupId!==state.managedGroupId||get().managedCreatorWalletId!==state.managedCreatorWalletId)throw new Error('The selected wallet group changed. Prepare this launch again.')
            return managed()
          }
          unsubscribeLibrary=useWalletLibraryStore.subscribe(()=>{try{resolveSigners()}catch{executionController?.abort()}})
        }else{
          resolveSigners=()=>{
            const live=get(),creator=validatePrivateKey(live.creatorPrivateKey)?.keypair
            if(!creator)throw new Error('The creator wallet is invalid or changed.')
            const wallets=new Map(state.bundleWallets.filter(wallet=>wallet.buyAmount>0).map(wallet=>{
              const current=live.bundleWallets.find(value=>value.id===wallet.id),key=current?validatePrivateKey(current.privateKey)?.keypair:undefined
              if(!key)throw new Error(`Wallet ${wallet.id} is invalid or changed.`)
              return [wallet.id,key] as const
            }))
            return {creator,wallets}
          }
        }
        const result = await executeBundleLaunch(state, (status) => {
          set({ statusMessage: status })
        },{signal:executionController!.signal,resolveSigners,onReceipt:receipt=>{ persistBundleCheckpoint(receipt); set({result:publicBundleReceipt(receipt)}) }})
        persistBundleCheckpoint(result)
        set({ result, statusMessage: result.success ? 'Launch successful!' : result.error || 'Failed' })
      })
    } catch (e) {
      set({
        statusMessage: e instanceof Error ? e.message : 'Execution failed',
        result: {...get().result,success:false,status:get().result?.status??'failed',error:e instanceof Error?e.message:'Unknown error'},
      })
    } finally {
      unsubscribeLibrary?.()
      executionController = null
      set({ isExecuting: false })
    }
  },

  reset: () => {
    if(get().isExecuting || get().result?.status==='unknown') {
      set({statusMessage:'Reconcile the saved transaction signatures before clearing this launch.'})
      return
    }
    set({
      ...initialState,
      managedGroupId:undefined,
      managedCreatorWalletId:undefined,
      bundleWallets: createEmptyWallets(),
      isExecuting: false,
      statusMessage: '',
      result: null,
      sniperMode: 'after_confirm',
      autoSellTriggerType: 'time',
      autoSellProfitMultiplier: 2,
    })
  },
  cancelPendingActions:()=>executionController?.abort(),
  reconcileResult:async()=>{
    if(get().isExecuting)return
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks) { set({ statusMessage: 'Use a current browser with secure cross-tab transaction coordination.' }); return }
    try {
      await locks.request('vanity-launch-submission', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Another tab is signing or checking a transaction. Try again when it finishes.')
        const result = readPendingBundleReceipt() || get().result
        if (!result?.submittedSignatures?.length) return
        set({statusMessage:'Checking saved signatures. No transactions will be sent.'})
        const connection=new Connection(getRpcEndpoint(),'confirmed')
        const outcome=await reconcileBundleReceipt(connection,result)
        if(outcome.creationStatus==='confirmed'&&result.creatorFeeRouting)await verifyCreatorFeeRoutingOnChain(connection,result.creatorFeeRouting,{payer:result.creatorFeeRouting.payer,mint:result.mintAddress!})
        persistBundleCheckpoint(outcome.receipt)
        settleMatchingLaunchPending(outcome)
        set({result:outcome.receipt,statusMessage:outcome.receipt.error??'Saved transactions confirmed'})
      })
    } catch (error) { set({ statusMessage: error instanceof Error ? error.message : 'Bundle confirmation could not be checked.' }) }
  },
}),{
  name:BUNDLE_RECEIPT_KEY,
  storage:createJSONStorage(()=>guardedBundleReceiptStorage(localStorage)),
  partialize:state=>({result:publicBundleReceipt(state.result)}),
  merge:(persisted,current)=>({...current,result:publicBundleReceipt((persisted as {result?:BundleResult})?.result??null)}),
}))
