import {afterEach,expect,it,vi} from 'vitest'
import {Connection,Keypair} from '@solana/web3.js'
import {executeRehearsal} from '../src/lib/server/rehearsal/execute'
import {consumerLaunchPlan} from './helpers/consumerLaunchPlan'
import type {CreatorFeeSelection} from '../src/lib/creatorFeeRouting'

const builders=vi.hoisted(()=>({create:vi.fn()}))
vi.mock('../src/lib/pumpfun/api',async original=>({...await original<typeof import('../src/lib/pumpfun/api')>(),buildCreateTransaction:builders.create}))
vi.mock('../src/lib/server/githubRecipient',()=>({resolveGitHubIndividual:async()=>({username:'Alice',userId:'12345',profileUrl:'https://github.com/Alice',accountType:'User'})}))
vi.mock('../src/lib/server/rehearsal/runtime',async original=>({...await original<typeof import('../src/lib/server/rehearsal/runtime')>(),acquireRehearsalRuntime:async()=> 'http://127.0.0.1:8899',verifyRehearsalRuntime:async()=>{},releaseRehearsalRuntime:async()=>{}}))
afterEach(()=>{vi.restoreAllMocks();builders.create.mockReset()})
const input={name:'Case test',symbol:'CASE',metadataUri:'https://example.com/token.json',initialBuySol:'0',priorityFeeSol:'0',jitoTipSol:'0.00001'}
function fixture(){
 vi.spyOn(Connection.prototype,'requestAirdrop').mockResolvedValue('disposable-funding')
 vi.spyOn(Connection.prototype,'getBalance').mockResolvedValue(1_000_010_000)
 const hydration=vi.spyOn(Connection.prototype,'getMultipleAccountsInfo').mockRejectedValue(new Error('Canonical route accepted before signing'))
 const send=vi.spyOn(Connection.prototype,'sendRawTransaction')
 builders.create.mockImplementation(params=>consumerLaunchPlan(params,Keypair.generate().publicKey.toBase58()))
 return {hydration,send}
}
it('accepts the freshly verified canonical GitHub spelling before signing a rehearsal',async()=>{
 const {hydration,send}=fixture()
 await expect(executeRehearsal({...input,creatorFeeSelection:{kind:'github',username:'alice'}},AbortSignal.timeout(1000))).rejects.toThrow('Canonical route accepted before signing')
 expect(hydration).toHaveBeenCalledTimes(1);expect(send).not.toHaveBeenCalled()
})
it.each<CreatorFeeSelection>([{kind:'wallet',address:Keypair.generate().publicKey.toBase58()},{kind:'holder-rewards'}])('rejects a rehearsal builder that replaces selected %s with deployer before signing',async creatorFeeSelection=>{
 const {hydration,send}=fixture()
 builders.create.mockImplementation(params=>consumerLaunchPlan({...params,creatorFeeSelection:{kind:'deployer'}},Keypair.generate().publicKey.toBase58()))
 await expect(executeRehearsal({...input,creatorFeeSelection},AbortSignal.timeout(1000))).rejects.toThrow('did not match the launch plan')
 expect(hydration).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled()
})
it('rejects replacement of the freshly verified GitHub numeric identity before rehearsal signing',async()=>{
 const {hydration,send}=fixture()
 builders.create.mockImplementation(params=>consumerLaunchPlan({...params,githubRecipient:{...params.githubRecipient!,userId:'12346'}},Keypair.generate().publicKey.toBase58()))
 await expect(executeRehearsal({...input,creatorFeeSelection:{kind:'github',username:'Alice'}},AbortSignal.timeout(1000))).rejects.toThrow('did not match the launch plan')
 expect(hydration).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled()
})
