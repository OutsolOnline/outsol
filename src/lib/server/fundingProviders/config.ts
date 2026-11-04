import {dirname,isAbsolute,relative,resolve,sep} from 'node:path'
import {FundingError} from '../../fundingProviders/model'
import {FundingStore} from './storage'
import {createSplitNowService} from './splitnow'

function settings(){
 const apiKey=process.env.SPLITNOW_API_KEY||'',encodedKey=process.env.FUNDING_STORAGE_KEY||'',directoryValue=process.env.FUNDING_STORAGE_DIR||''
 if(process.env.SPLITNOW_FUNDING_ENABLED!=='true'||!apiKey||apiKey.length>1_000||/[\s\x00-\x1f\x7f]/.test(apiKey)||!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)||!isAbsolute(directoryValue))throw new Error()
 const key=Buffer.from(encodedKey,'base64'),directory=resolve(directoryValue),volume=resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH||'/data')
 const otherDirectories=['ASSET_STORAGE_DIR','X_STORAGE_DIR','BACKGROUND_JOBS_STORAGE_DIR','AUTOMATION_STORAGE_DIR'].map(name=>process.env[name]).filter((value):value is string=>!!value).map(value=>resolve(value))
 const within=(parent:string,child:string)=>{const value=relative(parent,child);return value===''||value!=='..'&&!value.startsWith(`..${sep}`)&&!isAbsolute(value)}
 if(key.length!==32||key.toString('base64')!==encodedKey||dirname(directory)!==volume||directory===volume||otherDirectories.some(other=>within(other,directory)||within(directory,other)))throw new Error()
 return {apiKey,directory,key}
}
export function fundingAvailability(){
 let configured=false;try{settings();configured=true}catch{}
 return {platformFeeBps:0,splitnow:{configured,status:configured?'configured':'setup_required',supports:['sol-to-sol','multi-wallet','manual-deposit'],providerServiceFee:'Up to 1% plus partner-exchange and network charges.',quoteMode:'floating',maxWallets:20},husher:{configured:false,status:'partner_access_required',website:'https://www.husher.io/',explanation:'Integrated access for a third-party app requires written Husher Partner Access. Use Husher directly until that is arranged.'},liveProviderAcceptanceVerified:false}
}
let cached:{fingerprint:string;service:ReturnType<typeof createSplitNowService>}|undefined
export function fundingService(){
 try{
  const config=settings(),fingerprint=JSON.stringify([config.apiKey,config.directory,config.key.toString('base64')])
  if(!cached||cached.fingerprint!==fingerprint)cached={fingerprint,service:createSplitNowService({store:new FundingStore(config),apiKey:config.apiKey})}
  return cached.service
 }catch{throw new FundingError('setup_required',503,'Provider funding setup is required. The site owner must configure SplitNOW and private receipt storage.')}
}
