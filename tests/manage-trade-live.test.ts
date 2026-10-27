import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {Connection,PublicKey} from '@solana/web3.js'
import {PUMP_PROGRAM_ID,pumpIdl} from '@pump-fun/pump-sdk'
import bs58 from 'bs58'
import {unpackAccount} from '@solana/spl-token'
import {preparePumpTrade,readTokenPosition} from '../src/lib/venues/trade'

// Explicit opt-in. Existing public holders authorize no spend: every wallet
// signature stays zero, and send methods throw if any implementation invokes one.
describe.skipIf(process.env.RUN_MANAGE_TRADE_SIMULATION!=='1')('manual native trade read-only mainnet previews',()=>{
  it('prepares current native buy and sell transactions against real active curve state',async()=>{
    const endpoint=readFileSync('.env.local','utf8').match(/^\s*RPC_URL\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g,'')
    if(!endpoint)throw new Error('Configure a private RPC for this opt-in read-only test')
    const connection=new Connection(endpoint,'confirmed')
    connection.sendRawTransaction=async()=>{throw new Error('This read-only test forbids every send')}
    connection.sendTransaction=async()=>{throw new Error('This read-only test forbids every send')}
    let candidate:{mint:string;payer:string}|undefined
    try{
      const signatures=await connection.getSignaturesForAddress(PUMP_PROGRAM_ID,{limit:16},'confirmed')
      // Read v1 history as public JSON; the pinned wallet client constructs v0.
      const transactions=await Promise.all(signatures.map(async item=>{
        const response=await(await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',params:[item.signature,{encoding:'json',maxSupportedTransactionVersion:1,commitment:'confirmed'}]})})).json()
        return response.result
      }))
      const seen=new Set<string>()
      for(const response of transactions.reverse()){
        if(!response||response.meta?.err)continue
        const message=response.transaction.message,addresses=[...message.accountKeys,...response.meta?.loadedAddresses?.writable??[],...response.meta?.loadedAddresses?.readonly??[]]
        const keys={get:(index:number)=>addresses[index]?new PublicKey(addresses[index]):undefined}
        const rawInstructions=[...message.instructions,...(response.meta?.innerInstructions??[]).flatMap((group:{instructions:unknown[]})=>group.instructions)]
        const instructions=rawInstructions.map((ix:{programIdIndex:number;accounts:number[];data:string})=>({programIdIndex:ix.programIdIndex,accountKeyIndexes:ix.accounts,data:bs58.decode(ix.data)}))
        for(const instruction of instructions){
          if(!keys.get(instruction.programIdIndex)?.equals(PUMP_PROGRAM_ID))continue
          const discriminator=Buffer.from(instruction.data).subarray(0,8)
          const definition=pumpIdl.instructions.find(ix=>ix.name.startsWith('buy')&&discriminator.equals(Buffer.from(ix.discriminator)))
          if(!definition)continue
          const mintIndex=definition.accounts.findIndex(account=>account.name==='mint'||account.name==='base_mint'),userIndex=definition.accounts.findIndex(account=>account.name==='user')
          if(mintIndex<0||userIndex<0)continue
          const mint=keys.get(instruction.accountKeyIndexes[mintIndex])!.toBase58()
          if(seen.has(mint))continue;seen.add(mint)
          let position;try{position=await readTokenPosition(connection,mint,'ProCXqRcXJjoUd1RNoo28bSizAA6EEqt9wURZYPDc5u')}catch{continue}
          if(position.status!=='active')continue
          const largest=await connection.getTokenLargestAccounts(new PublicKey(mint),'confirmed')
          const tokenAccounts=largest.value.slice(0,6)
          const holderAccounts=await connection.getMultipleAccountsInfo(tokenAccounts.map(account=>account.address),'confirmed')
          for(let i=0;i<holderAccounts.length;i++){
            const account=holderAccounts[i];if(!account)continue
            const holder=unpackAccount(tokenAccounts[i].address,account,new PublicKey(position.tokenProgram)).owner
            if(!PublicKey.isOnCurve(holder.toBytes()))continue
            const holding=await readTokenPosition(connection,mint,holder.toBase58())
            if(BigInt(holding.tokenRaw)>1000n&&BigInt(holding.solLamports)>1_000_000n){candidate={mint,payer:holder.toBase58()};break}
          }
          if(candidate)break
        }
        if(candidate)break
      }
    }catch(error){const detail=error instanceof Error?error.message.replaceAll(endpoint,'[RPC]').replace(/https?:\/\/[^\s]+/g,'[RPC]'):'Unknown read error';throw new Error(`Public active-holder discovery failed: ${detail}`)}
    if(!candidate)throw new Error('No active funded holder found in the recent public sample; retry this optional simulation')
    for(const action of ['buy','sell'] as const){
      const payer=action==='buy'?'ProCXqRcXJjoUd1RNoo28bSizAA6EEqt9wURZYPDc5u':candidate.payer
      let prepared
      try{prepared=await preparePumpTrade(connection,{action,mint:candidate.mint,payer,buySol:'0.01',sellPercent:25,slippage:10,priorityFeeSol:0.00002})}
      catch(error){throw new Error(`Native ${action} preview failed: ${error instanceof Error&&!error.message.includes('http')?error.message:'RPC credentials suppressed'}`)}
      expect(prepared.transaction.signatures.every(signature=>signature.every(byte=>byte===0))).toBe(true)
      expect(prepared.position.status).toBe('active')
      expect(BigInt(prepared.tokenChangeRaw)>0n).toBe(action==='buy')
      if(action==='buy')expect(prepared.maxBuyLamports).toBe('10000000')
      else expect(prepared.maxSellRaw).toBe((-BigInt(prepared.tokenChangeRaw)).toString())
    }
  },60_000)
})
