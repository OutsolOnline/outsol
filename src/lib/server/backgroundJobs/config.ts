import {isAbsolute,resolve,dirname,parse,relative} from 'node:path'
import {validHistoryRpcUrl} from './rpc'

export interface BackgroundJobReadiness {
 available:boolean;reason:string|null;supportedKinds:['token-history'];maxTransactions:500;retentionDays:7
}
const contained=(parent:string,child:string)=>{const value=relative(parent,child);return value===''||(!value.startsWith('..')&&!isAbsolute(value))}
export function resolveBackgroundJobConfig(environment:NodeJS.ProcessEnv=process.env):{storage:string;rpcUrl:string}|null{
 const value=environment.BACKGROUND_JOBS_STORAGE_DIR,rpcUrl=validHistoryRpcUrl(environment.RPC_URL,environment.NODE_ENV==='production')
 if(!value||!isAbsolute(value)||!rpcUrl)return null
 const storage=resolve(value),volume=resolve(environment.RAILWAY_VOLUME_MOUNT_PATH||'/data')
 if(storage===parse(storage).root)return null
 if(environment.NODE_ENV==='production'&&(volume===parse(volume).root||dirname(storage)!==volume))return null
 for(const other of [environment.ASSET_STORAGE_DIR,environment.X_STORAGE_DIR,environment.FUNDING_STORAGE_DIR,environment.AUTOMATION_STORAGE_DIR]){
  if(!other)continue
  const path=resolve(other);if(contained(path,storage)||contained(storage,path))return null
 }
 return{storage,rpcUrl}
}
export function backgroundJobReadiness(environment:NodeJS.ProcessEnv=process.env):BackgroundJobReadiness{
 const ready=!!resolveBackgroundJobConfig(environment)
 return{available:ready,reason:ready?null:'Background history indexing needs private persistent storage and a server RPC.',supportedKinds:['token-history'],maxTransactions:500,retentionDays:7}
}
