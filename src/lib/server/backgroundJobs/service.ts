import {randomBytes} from 'node:crypto'
import {join} from 'node:path'
import {BackgroundJobStore} from './store'
import {resolveBackgroundJobConfig} from './config'
import {createHistoryReader} from './rpc'
import {runHistoryJob} from './worker'

type Runtime={store:BackgroundJobStore;rpcUrl:string;workerId:string;timer:ReturnType<typeof setInterval>|null;busy:boolean}
const globalRuntime=globalThis as typeof globalThis&{launchpierBackgroundJobRuntime?:Runtime}
export function getBackgroundJobStore():BackgroundJobStore|null{
 if(globalRuntime.launchpierBackgroundJobRuntime)return globalRuntime.launchpierBackgroundJobRuntime.store
 const config=resolveBackgroundJobConfig();if(!config)return null
 const store=new BackgroundJobStore(join(config.storage,'jobs.sqlite'))
 globalRuntime.launchpierBackgroundJobRuntime={store,rpcUrl:config.rpcUrl,workerId:randomBytes(12).toString('hex'),timer:null,busy:false};return store
}
/** Call from Next's Node instrumentation hook. A single unref'd timer resumes
 * durable queued/expired-lease jobs without keeping a stopped process alive. */
export function startBackgroundJobWorker():void{
 try{
  const store=getBackgroundJobStore(),runtime=globalRuntime.launchpierBackgroundJobRuntime;if(!store||!runtime||runtime.timer)return
  const reader=createHistoryReader(runtime.rpcUrl,{reserveRead:()=>store.reserveRpcRead()})
  const tick=async()=>{if(runtime.busy)return;runtime.busy=true;try{const lease=store.claim(runtime.workerId);if(lease)await runHistoryJob(store,lease,reader)}catch{/* Do not log capabilities, RPC URLs or chain payloads. The durable lease can recover. */}finally{runtime.busy=false}}
  runtime.timer=setInterval(()=>{void tick()},1500);runtime.timer.unref();void tick()
 }catch{/* Invalid/unwritable configuration is reported by the private readiness endpoint. */}
}
