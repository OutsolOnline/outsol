import { afterEach,describe, expect, it,vi } from 'vitest'
import { Connection, Keypair,PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import BN from 'bn.js'
import {OnlinePumpSdk,type Global} from '@pump-fun/pump-sdk'
import { buildCreateRequestBody,buildCreateTransaction } from '../src/lib/pumpfun/api'

afterEach(()=>vi.restoreAllMocks())
const zero=PublicKey.default
const global={initialized:true,authority:zero,feeRecipient:Keypair.generate().publicKey,initialVirtualTokenReserves:new BN('1073000000000000'),initialVirtualSolReserves:new BN('30000000000'),initialVirtualQuoteReserves:new BN('30000000000'),initialRealTokenReserves:new BN('793100000000000'),tokenTotalSupply:new BN('1000000000000000'),feeBasisPoints:new BN(100),creatorFeeBasisPoints:new BN(0),buybackBasisPoints:new BN(0),feeRecipients:Array.from({length:7},()=>Keypair.generate().publicKey),creatorFeeConfigurable:false,maxConfigurableCreatorFeeBps:new BN(0),isHolderRewardEnabled:true,createV2Enabled:true,mayhemModeEnabled:false,reservedFeeRecipient:zero,reservedFeeRecipients:[]} as unknown as Global
function offlineConnection(){
 vi.spyOn(OnlinePumpSdk.prototype,'fetchGlobal').mockResolvedValue(global)
 vi.spyOn(OnlinePumpSdk.prototype,'fetchFeeConfig').mockResolvedValue(null as never)
 const connection=new Connection('http://127.0.0.1:8899')
 vi.spyOn(connection,'getLatestBlockhash').mockResolvedValue({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100})
 vi.spyOn(connection,'getAccountInfo').mockResolvedValue(null)
 vi.spyOn(connection,'getMultipleAccountsInfo').mockImplementation(async keys=>keys.map(()=>({owner:new PublicKey('T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt'),data:Buffer.from('ySH0dOBEYSg=','base64'),lamports:1_000_000,executable:false,rentEpoch:0})))
 vi.spyOn(connection,'getMinimumBalanceForRentExemption').mockResolvedValue(1_000_000)
 return connection
}

describe('PumpPortal create request safety', () => {
  it.each(['deployer','wallet','holder-rewards','github'] as const)('returns one validated packet plan for %s including zero-buy setup',async kind=>{
    const payer=Keypair.generate(),mint=Keypair.generate(),address=Keypair.generate().publicKey.toBase58(),connection=offlineConnection()
    const creatorFeeSelection=kind==='wallet'?{kind,address}:kind==='github'?{kind,username:'octocat'}:{kind}
    const result=await buildCreateTransaction({connection,userPublicKey:payer.publicKey.toBase58(),mintKeypair:mint,creatorFeeSelection,githubRecipient:kind==='github'?{userId:'583231',username:'octocat',profileUrl:'https://github.com/octocat',accountType:'User'}:undefined,metadata:{name:'N'.repeat(32),symbol:'S'.repeat(10),description:''},metadataUri:'https://example.com/'.padEnd(200,'m'),initialBuyAmount:0,priorityFee:0.00002,jitoTipLamports:10_000})
    expect(result.error).toBeUndefined();expect(result.success).toBe(true)
    expect(result.launchPlan!.routing.selection.kind).toBe(kind)
    expect(result.launchPlan!.packets).toEqual(result.transactions)
    expect(result.launchPlan!.requiresAtomicBundle).toBe(result.requiresAtomicBundle)
    expect(result.nativeContext!.curve.creator.toBase58()).toBe(result.launchPlan!.routing.effectiveCreator)
    expect(result.transactions!.every(tx=>tx.serialize().length<=1232)).toBe(true)
    expect(result.transactions!.length).toBeLessThanOrEqual(3)
    expect(result.jitoTipLamports).toBe(result.transactions!.length===1?'0':'10000')
    if(kind==='github')expect(result.launchPlan!.stepsByPacket.flat()).toEqual(expect.arrayContaining(['github-social-create','github-sharing-create','github-shares-set']))
  })
  it('fails explicit cashback and malformed selection without silently selecting deployer',async()=>{
    const args={connection:offlineConnection(),userPublicKey:Keypair.generate().publicKey.toBase58(),mintKeypair:Keypair.generate(),metadata:{name:'No fallback',symbol:'NO',description:''},metadataUri:'ipfs://no'}
    for(const creatorFeeSelection of [{kind:'cashback'},{kind:'mystery'},null]){const result=await buildCreateTransaction({...args,creatorFeeSelection:creatorFeeSelection as never});expect(result.success).toBe(false);expect(result.launchPlan).toBeUndefined()}
  })
  it('rejects an otherwise on-curve wallet key when live state shows an executable program',async()=>{
    const connection=offlineConnection(),recipient=Keypair.generate().publicKey
    vi.mocked(connection.getAccountInfo).mockResolvedValue({owner:new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),data:Buffer.alloc(0),lamports:1,executable:true,rentEpoch:0})
    const built=await buildCreateTransaction({connection,userPublicKey:Keypair.generate().publicKey.toBase58(),mintKeypair:Keypair.generate(),creatorFeeSelection:{kind:'wallet',address:recipient.toBase58()},metadata:{name:'Wallet',symbol:'WAL',description:''},metadataUri:'ipfs://wallet'})
    expect(built.success).toBe(false);expect(built.error).toMatch(/wallet|executable/i)
  })
  it('reserves an exact standalone final tip for atomic consumers adding immediate buyers',async()=>{
    const args={connection:offlineConnection(),userPublicKey:Keypair.generate().publicKey.toBase58(),mintKeypair:Keypair.generate(),creatorFeeSelection:{kind:'holder-rewards' as const},metadata:{name:'N'.repeat(32),symbol:'S'.repeat(10),description:''},metadataUri:'https://example.com/'.padEnd(200,'m'),initialBuyAmount:0.1,priorityFee:0.00002,jitoTipLamports:10000}
    const automatic=await buildCreateTransaction(args),separate=await buildCreateTransaction({...args,separateJitoTip:true})
    expect(automatic.success,automatic.error).toBe(true);expect(separate.success,separate.error).toBe(true)
    expect(automatic.launchPlan!.packets).toHaveLength(2)
    expect(separate.launchPlan!.packets).toHaveLength(3)
    expect(separate.launchPlan!.stepsByPacket.at(-1)).toEqual(['validator-tip'])
    expect(separate.launchPlan!.stepsByPacket.flat().filter(step=>step==='first-buy')).toHaveLength(1)
    expect(separate.tokenAmountRaw).toBe(automatic.tokenAmountRaw)
  })
  it('sends the mint public key and never the mint secret key', () => {
    const mint = Keypair.generate()
    const secret = bs58.encode(mint.secretKey)
    const request = buildCreateRequestBody({
      userPublicKey: Keypair.generate().publicKey.toBase58(),
      metadata: { name: 'Launcher Test', symbol: 'LTEST' },
      metadataUri: 'ipfs://test-metadata',
      mint: mint.publicKey.toBase58(),
      initialBuyAmount: 0,
      slippage: 10,
      priorityFee: 0.0005,
    })

    expect(request.mint).toBe(mint.publicKey.toBase58())
    expect(JSON.stringify(request)).not.toContain(secret)
    expect(request).not.toHaveProperty('secretKey')
  })
})
