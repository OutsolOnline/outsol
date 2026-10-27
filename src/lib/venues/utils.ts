import {ComputeBudgetProgram,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js'
import {createJitoTipTransaction} from '@/lib/bundler/jito'
import type {VenueLaunchInput} from './types'

export function validateVenueInput(input:Omit<VenueLaunchInput,'connection'>):{buyLamports:bigint;priorityLamports:bigint}{
  if(!input.name.trim()||Buffer.byteLength(input.name)>32||!input.symbol.trim()||Buffer.byteLength(input.symbol)>10)throw new Error('Token name or symbol is invalid')
  if(!/^(https:\/\/|ipfs:\/\/)/.test(input.metadataUri)||Buffer.byteLength(input.metadataUri)>200)throw new Error('A public HTTPS/IPFS metadata URI up to 200 UTF-8 bytes is required')
  if(!Number.isFinite(input.initialBuySol)||input.initialBuySol<0||input.initialBuySol>1_000_000)throw new Error('Initial buy SOL amount is invalid')
  if(!Number.isFinite(input.priorityFeeSol)||input.priorityFeeSol<0||input.priorityFeeSol>0.01)throw new Error('Priority fee must be 0–0.01 SOL')
  if(!Number.isFinite(input.slippage)||input.slippage<0||input.slippage>50)throw new Error('Slippage must be between 0% and 50%')
  if(!Number.isSafeInteger(input.jitoTipLamports)||input.jitoTipLamports<1000||input.jitoTipLamports>100_000_000)throw new Error('Jito tip must be 1,000–100,000,000 lamports')
  return {buyLamports:BigInt(Math.round(input.initialBuySol*1e9)),priorityLamports:BigInt(Math.round(input.priorityFeeSol*1e9))}
}

/** Preserve instruction order and reserve one packet for a real Jito tip. */
export function packVenueTransactions(instructions:TransactionInstruction[],payer:PublicKey,blockhash:string,priorityLamports:bigint,jitoTipLamports:number):VersionedTransaction[]{
  const make=(group:TransactionInstruction[],fee:bigint)=>new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:500_000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:fee*1_000_000n/500_000n}),...group]}).compileToV0Message())
  const fits=(group:TransactionInstruction[])=>{try{return make(group,0n).serialize().length<=1232}catch{return false}}
  const groups:TransactionInstruction[][]=[]
  let current:TransactionInstruction[]=[]
  for(const instruction of instructions){
    if(fits([...current,instruction]))current.push(instruction)
    else{
      if(current.length===0||!fits([instruction]))throw new Error('A native venue instruction exceeds the Solana packet size; shorten metadata')
      groups.push(current);current=[instruction]
    }
  }
  if(current.length)groups.push(current)
  if(groups.length===0||groups.length>4)throw new Error('This native launch cannot fit within an atomic five-transaction bundle')
  const fee=priorityLamports/BigInt(groups.length)
  const transactions=groups.map(group=>make(group,fee))
  if(transactions.length>1)transactions.push(createJitoTipTransaction(payer,blockhash,jitoTipLamports))
  return transactions
}
