import {describe,it,expect} from 'vitest'
import {Keypair,PublicKey} from '@solana/web3.js'
import {holderRewardsPda,feeSharingConfigPda,socialFeePda} from '@pump-fun/pump-sdk'
import {parseCreatorFeeSelection,requireSupportedCreatorFeeSelection,migrateLegacyCreatorFeeSelection,resolveCreatorFeeRouting,parseResolvedCreatorFeeRouting,assertCreatorFeeRoutingAvailable} from '../src/lib/creatorFeeRouting'

const payer=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58()
const github={userId:'12345',username:'Octocat',profileUrl:'https://github.com/Octocat',accountType:'User' as const}
describe('creator fee routing public intent',()=>{
 it('migrates only absent legacy values and rejects malformed present intent',()=>{
  expect(migrateLegacyCreatorFeeSelection(undefined)).toEqual({kind:'deployer'})
  for(const value of [null,{},'',{kind:'other'},{kind:'deployer',address:payer},{kind:'wallet',address:PublicKey.default.toBase58()},{kind:'wallet',address:holderRewardsPda(new PublicKey(mint)).toBase58()},{kind:'github',username:'x/y'},{kind:'github',username:'alice--name'}]) expect(()=>migrateLegacyCreatorFeeSelection(value)).toThrow()
  expect(parseCreatorFeeSelection({kind:'cashback'})).toEqual({kind:'cashback'})
  expect(()=>requireSupportedCreatorFeeSelection({kind:'cashback'})).toThrow(/CashbackDeprecated|6082/)
 })
 it('derives wallet and holder creators without adding editable flags',()=>{
  const address=Keypair.generate().publicKey.toBase58()
  expect(resolveCreatorFeeRouting({selection:{kind:'wallet',address},payer,mint}).effectiveCreator).toBe(address)
  const route=resolveCreatorFeeRouting({selection:{kind:'holder-rewards'},payer,mint})
  expect(route.encodedCreator).toBe(payer);expect(route.effectiveCreator).toBe(holderRewardsPda(new PublicKey(mint)).toBase58());expect(route.holderReward).toBe(true)
  expect(()=>assertCreatorFeeRoutingAvailable(route,{isHolderRewardEnabled:false})).toThrow(/holder/i)
  expect(()=>assertCreatorFeeRoutingAvailable(route,{isHolderRewardEnabled:true})).not.toThrow()
 })
 it('rejects executable protocol and system addresses as wallet destinations',()=>{
  for(const address of ['metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s','BPFLoaderUpgradeab1e11111111111111111111111','Ed25519SigVerify111111111111111111111111111'])expect(()=>parseCreatorFeeSelection({kind:'wallet',address})).toThrow()
 })
 it('binds immutable GitHub individual identity to sharing and social PDAs',()=>{
  const route=resolveCreatorFeeRouting({selection:{kind:'github',username:'octocat'},payer,mint,github})
  expect(route.encodedCreator).toBe(payer);expect(route.initialCurveCreator).toBe(payer)
  expect(route.effectiveCreator).toBe(feeSharingConfigPda(new PublicKey(mint)).toBase58())
  expect(route.socialRecipient).toBe(socialFeePda('12345',2).toBase58())
  expect(parseResolvedCreatorFeeRouting(JSON.parse(JSON.stringify(route)))).toEqual(route)
  for(const mutation of [{effectiveCreator:payer},{socialRecipient:payer},{github:{...github,userId:'001'}},{github:{...github,accountType:'Organization'}},{extra:true}])expect(()=>parseResolvedCreatorFeeRouting({...route,...mutation})).toThrow()
  expect(()=>resolveCreatorFeeRouting({selection:{kind:'github',username:'someone'},payer,mint,github})).toThrow()
 })
})
