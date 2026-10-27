import {describe,expect,it} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {validateBundleConfig} from '../src/lib/bundler/api'
import {useBundlerStore} from '../src/stores/bundlerStore'
import {publicBundleReceipt} from '../src/lib/bundler/receipt'

function configuration() {
  const base=useBundlerStore.getState()
  return {...base,tokenName:'Bundle Test',tokenSymbol:'BTEST',tokenImage:new Blob(['image'],{type:'image/png'}) as File,
    creatorPrivateKey:bs58.encode(Keypair.generate().secretKey),mintMode:'random' as const,
    bundleWallets:base.bundleWallets.slice(0,4).map(wallet=>({...wallet,privateKey:bs58.encode(Keypair.generate().secretKey),buyAmount:0.1,isValid:true})),
    sniperMode:'block0' as const}
}
describe('bundle launch input safety',()=>{
  it('validates the optional bundle tip reserve in sequential modes too',()=>{
    const config={...configuration(),sniperMode:'after_confirm' as const,bundleWallets:[]}
    config.jitoTip=NaN
    expect(()=>validateBundleConfig(config)).toThrow(/amount|tip/i)
    config.jitoTip=0
    expect(()=>validateBundleConfig(config)).not.toThrow()
  })
  it('persists only public transaction receipts, never wallet keys or launch configuration',()=>{
    const input={success:false,status:'unknown' as const,mintAddress:Keypair.generate().publicKey.toBase58(),createSignature:'saved-signature',submittedSignatures:['saved-signature'],creatorPrivateKey:'do-not-store',bundleWallets:[{privateKey:'also-secret'}]}
    expect(JSON.stringify(publicBundleReceipt(input))).not.toContain('do-not-store')
    expect(JSON.stringify(publicBundleReceipt(input))).not.toContain('also-secret')
    expect(publicBundleReceipt(input)?.submittedSignatures).toEqual(['saved-signature'])
  })
  it('rejects four atomic buyers before metadata uploads or transaction signing',()=>{
    expect(()=>validateBundleConfig(configuration())).toThrow(/three|3|five|5/i)
  })
  it('rejects invalid amounts and repeated wallet identities',()=>{
    const config=configuration();config.bundleWallets=config.bundleWallets.slice(0,2)
    config.bundleWallets[0].buyAmount=NaN
    expect(()=>validateBundleConfig(config)).toThrow(/amount|finite|budget/i)
    config.bundleWallets[0].buyAmount=0.1
    config.bundleWallets[1].privateKey=config.bundleWallets[0].privateKey
    expect(()=>validateBundleConfig(config)).toThrow(/duplicate|repeated|unique/i)
  })
  it('rejects unimplemented profit automation instead of claiming a profit guarantee',()=>{
    const config=configuration();config.bundleWallets=[];config.devBuyAmount=0.1;config.autoSellEnabled=true;config.autoSellTriggerType='profit'
    expect(()=>validateBundleConfig(config)).toThrow(/profit|unsupported|time/i)
  })
})
