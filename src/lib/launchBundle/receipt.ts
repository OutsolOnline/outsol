import type {LaunchBundleSettings} from './types'

export interface LaunchBundleOutcome {
 mode:LaunchBundleSettings['mode']
 buyerCount:number
 status:'confirmed'|'partial'
 message?:string
}
/** A small public outcome survives recovery without persisting any execution context. */
export function publicLaunchBundleOutcome(value:unknown):LaunchBundleOutcome{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The bundle outcome cannot be read.')
 const input=value as LaunchBundleOutcome
 if(!['manual','organic','block0'].includes(input.mode)||!Number.isInteger(input.buyerCount)||input.buyerCount<0||input.buyerCount>16||!['confirmed','partial'].includes(input.status))throw new Error('The bundle outcome is invalid.')
 if(input.message!==undefined&&(typeof input.message!=='string'||input.message.length>2000||/[\u0000-\u001f\u007f]/.test(input.message)))throw new Error('The bundle outcome message is invalid.')
 return {mode:input.mode,buyerCount:input.buyerCount,status:input.status,...(input.message?{message:input.message}:{})}
}
