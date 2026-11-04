import {CAPABILITY_PATTERN} from './model'
export const FUNDING_RECOVERY_KEY='launchpier-splitnow-receipts-v1'
export interface FundingRecovery {version:1;kind:'launchpier-splitnow-funding';capability:string;createdAt:string}
export function parseFundingRecovery(value:unknown):FundingRecovery{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Choose a LaunchPier funding recovery file.')
 const row=value as Record<string,unknown>
 if(Object.keys(row).some(key=>!['version','kind','capability','createdAt'].includes(key))||row.version!==1||row.kind!=='launchpier-splitnow-funding'||typeof row.capability!=='string'||!CAPABILITY_PATTERN.test(row.capability)||typeof row.createdAt!=='string'||row.createdAt.length>32||!Number.isFinite(Date.parse(row.createdAt)))throw new Error('Choose a valid LaunchPier funding recovery file. Wallet key files are not accepted here.')
 return {version:1,kind:'launchpier-splitnow-funding',capability:row.capability,createdAt:new Date(row.createdAt).toISOString()}
}
export function readFundingRecoveries(storage:Pick<Storage,'getItem'>):FundingRecovery[]{
 const raw=storage.getItem(FUNDING_RECOVERY_KEY);if(raw===null)return []
 if(raw.length>16_384)throw new Error('Saved funding receipts could not be read. Import a recovery file instead.')
 const value:unknown=JSON.parse(raw);if(!Array.isArray(value)||value.length>20)throw new Error('Saved funding receipts could not be read. Import a recovery file instead.')
 return value.map(parseFundingRecovery)
}
export function saveFundingRecovery(storage:Pick<Storage,'getItem'|'setItem'>,recovery:FundingRecovery):FundingRecovery[]{
 const receipt=parseFundingRecovery(recovery),existing=readFundingRecoveries(storage),next=[receipt,...existing.filter(row=>row.capability!==receipt.capability)].slice(0,20)
 storage.setItem(FUNDING_RECOVERY_KEY,JSON.stringify(next));return next
}
