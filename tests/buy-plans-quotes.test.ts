import {describe,expect,it} from 'vitest'
import {PublicKey} from '@solana/web3.js'
import BN from 'bn.js'
import type {Global} from '@pump-fun/pump-sdk'
import {estimateSupplyTargets} from '../src/lib/buyPlans/quotes'

const global={initialized:true,authority:PublicKey.default,feeRecipient:PublicKey.default,initialVirtualTokenReserves:new BN('1073000000000000'),initialVirtualSolReserves:new BN('30000000000'),initialVirtualQuoteReserves:new BN('30000000000'),initialRealTokenReserves:new BN('793100000000000'),tokenTotalSupply:new BN('1000000000000000'),feeBasisPoints:new BN(0),creatorFeeBasisPoints:new BN(0),buybackBasisPoints:new BN(0),feeRecipients:[],creatorFeeConfigurable:false,maxConfigurableCreatorFeeBps:new BN(0),isHolderRewardEnabled:false} as unknown as Global

describe('supply target funding estimates',()=>{
 it('quotes exact supply targets with independent rent, base network and priority costs',()=>{
  const estimate=estimateSupplyTargets({global,feeConfig:null,targets:[{name:'Creator',basisPoints:100}],rentLamportsPerBuyer:'2000000',baseNetworkLamportsPerBuyer:'5000',priorityLamportsPerBuyer:'100000'})
  // 30e9 * 1e13 / (1.073e15 - 1e13), rounded up by the native Pump quote.
  expect(estimate.rows[0]).toMatchObject({tokenRaw:'10000000000000',buyLamports:'282220132',rentLamports:'2000000',baseNetworkLamports:'5000',priorityLamports:'100000'})
  expect(estimate.totalFundingLamports).toBe('284325132');expect(estimate.remainingSupplyBasisPoints).toBe(9900)
 })
 it('prices later allocations on the advanced curve and refuses impossible targets',()=>{
  const options={global,feeConfig:null,targets:[{name:'Creator',basisPoints:100},{name:'Holders',basisPoints:100}],rentLamportsPerBuyer:'0',baseNetworkLamportsPerBuyer:'0',priorityLamportsPerBuyer:'0'}
  const estimate=estimateSupplyTargets(options)
  expect(BigInt(estimate.rows[1].buyLamports)).toBeGreaterThan(BigInt(estimate.rows[0].buyLamports));expect(estimate.rows.map(row=>row.tokenRaw)).toEqual(['10000000000000','10000000000000'])
  expect(()=>estimateSupplyTargets({...options,targets:[{name:'Unavailable',basisPoints:9000}]})).toThrow(/available|complete|curve/i)
  expect(()=>estimateSupplyTargets({...options,targets:[{name:'Fraction',basisPoints:0.1}]})).toThrow(/basis|whole/i)
 })
})
