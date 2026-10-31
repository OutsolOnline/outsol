import {afterEach,it,expect,vi} from 'vitest'
import {Keypair} from '@solana/web3.js'
import {TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {createMarketBuildHandler} from '../src/lib/sales/provider'
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs()})
it('paces read-only market builds so a group preview respects the keyless request allowance',async()=>{
 vi.useFakeTimers();vi.stubEnv('APP_ORIGIN','https://outsol.online');vi.stubEnv('JUPITER_API_KEY','')
 const fetcher=vi.fn(async()=>Response.json({inputMint:'public',outAmount:'1'})),handler=createMarketBuildHandler({fetch:fetcher})
 const body={payer:Keypair.generate().publicKey.toBase58(),mint:Keypair.generate().publicKey.toBase58(),amountRaw:'1',decimals:6,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),slippageBps:500,priorityFeeLamports:'0'}
 const request=()=>new Request('https://outsol.online/api/sales/build',{method:'POST',headers:{Origin:'https://outsol.online','Content-Type':'application/json'},body:JSON.stringify(body)})
 expect((await handler(request())).status).toBe(200)
 const second=handler(request());await vi.advanceTimersByTimeAsync(1)
 expect(fetcher).toHaveBeenCalledOnce()
 await vi.advanceTimersByTimeAsync(2200);expect((await second).status).toBe(200);expect(fetcher).toHaveBeenCalledTimes(2)
})
