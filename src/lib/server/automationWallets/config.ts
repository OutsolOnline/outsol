import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path'
import {lstatSync,existsSync,realpathSync} from 'node:fs'
import {Connection,PublicKey} from '@solana/web3.js'
import {AutomationError} from '../../automationWallets/model'
import {withTimeout} from '../../transactions/http'
import {AutomationStore} from './store'
import {AutomationWorker,createAutomationPorts,type AutomationPorts} from './worker'
import {createAutomationService} from './service'
import {createAutomationRpcFetch} from './rpc'

export function automationSettings(){
 const encoded=process.env.AUTOMATION_WALLET_ENCRYPTION_KEY||'',value=process.env.AUTOMATION_STORAGE_DIR||'',rpcValue=process.env.RPC_URL||''
 if(!/^[A-Za-z0-9+/]{43}=$/.test(encoded)||!isAbsolute(value)||!rpcValue)throw new Error('Automation setup required')
 const key=Buffer.from(encoded,'base64'),directory=resolve(value),volume=resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH||'/data'),rpc=new URL(rpcValue)
 const within=(parent:string,child:string)=>{const r=relative(parent,child);return r===''||r!=='..'&&!r.startsWith(`..${sep}`)&&!isAbsolute(r)}
 const others=['ASSET_STORAGE_DIR','X_STORAGE_DIR','FUNDING_STORAGE_DIR','BACKGROUND_JOBS_STORAGE_DIR'].map(name=>process.env[name]).filter((v):v is string=>!!v).map(v=>resolve(v))
 const local=process.env.NODE_ENV!=='production'&&process.env.AUTOMATION_ALLOW_LOCAL_TEST_RPC==='true'&&['localhost','127.0.0.1','[::1]'].includes(rpc.hostname)
 if(key.length!==32||key.toString('base64')!==encoded||dirname(directory)!==volume||directory===volume||others.some(other=>within(other,directory)||within(directory,other))||existsSync(directory)&&lstatSync(directory).isSymbolicLink()||existsSync(volume)&&realpathSync(volume)!==volume)throw new Error('Automation setup required')
 if(rpc.username||rpc.password||rpc.hash||rpcValue.length>2048||rpc.protocol!=='https:'&&!(local&&rpc.protocol==='http:')||(!local&&['localhost','127.0.0.1','[::1]'].includes(rpc.hostname)))throw new Error('Mainnet server RPC required')
 return {key,directory,rpc:rpc.toString(),enabled:process.env.AUTOMATION_TRADING_ENABLED==='true'}
}
export function automationReadiness(){try{const s=automationSettings();return {configured:true,enabled:s.enabled,workerRunning:!!(globalThis as WorkerGlobal)[workerSymbol],mode:'scheduled-dca',maxTrades:10,maxTotalDebitSol:'1',walletLimit:100}}catch{return {configured:false,enabled:false,workerRunning:false,mode:'scheduled-dca',maxTrades:10,maxTotalDebitSol:'1',walletLimit:100}}}
let cached:{fingerprint:string;store:AutomationStore;ports:AutomationPorts;service:ReturnType<typeof createAutomationService>}|undefined
export function automationRuntime(){try{
 const s=automationSettings(),fingerprint=JSON.stringify([s.directory,s.rpc,s.key.toString('base64')])
 if(!cached||cached.fingerprint!==fingerprint){
  if(cached)throw new Error('Restart needed for automation configuration changes')
  const store=new AutomationStore(join(s.directory,'wallets.sqlite'),s.key),connection=new Connection(s.rpc,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:createAutomationRpcFetch(s.rpc)}),ports=createAutomationPorts(connection)
  cached={fingerprint,store,ports,service:createAutomationService({store,ports,balance:async address=>String(await withTimeout(connection.getBalance(new PublicKey(address),'confirmed'))),enabled:()=>process.env.AUTOMATION_TRADING_ENABLED==='true',ensureWorker:()=>{if(!startAutomationWalletWorker())throw new AutomationError(503,'The unattended worker could not start. The reviewed plan has not been armed.')},workerReady:()=>!!(globalThis as WorkerGlobal)[workerSymbol]})}
 }return cached
 }catch{throw new AutomationError(503,'Dedicated automation wallets need private persistent storage, an encryption key, and a mainnet server RPC configured by the site owner.')}
}
const workerSymbol=Symbol.for('launchpier.automation.worker')
type WorkerGlobal=typeof globalThis&{[workerSymbol]?:{stop:()=>void}}
/** Start once in the server runtime. Database leases also fence independent processes. */
export function startAutomationWalletWorker():{stop:()=>void}|null {
 const global=globalThis as WorkerGlobal;if(global[workerSymbol])return global[workerSymbol]!
 if(!automationReadiness().enabled)return null
 const {store,ports}=automationRuntime(),worker=new AutomationWorker(store,ports);let stopped=false
 const tick=()=>{if(!stopped&&process.env.AUTOMATION_TRADING_ENABLED==='true')void worker.tick().catch(()=>{/* Public readiness never includes RPC or key material. */})}
 const interval=setInterval(tick,15_000);interval.unref()
 const stop=()=>{stopped=true;clearInterval(interval);worker.stop();delete global[workerSymbol]}
 global[workerSymbol]={stop};process.once('SIGTERM',stop);process.once('SIGINT',stop);tick();return global[workerSymbol]!
}
