import type {AccountingSummary} from './fills'
import {canonicalAddress} from '../market/validation'
export function formatEvidenceAmount(value:string,decimals=9,precision=6):string{
 if(!/^-?\d{1,40}$/.test(value)||!Number.isInteger(decimals)||decimals<0||decimals>18)return 'Unavailable'
 const amount=BigInt(value),sign=amount<0n?'-':'',absolute=amount<0n?-amount:amount,scale=10n**BigInt(decimals)
 const fraction=(absolute%scale).toString().padStart(decimals,'0').slice(0,precision).replace(/0+$/,'')
 return `${sign}${absolute/scale}${fraction?`.${fraction}`:''}`
}
const xml=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;')
export function performanceSvg(summary:AccountingSummary,mint:string,generatedAt:string):string{
 if(!canonicalAddress(mint)||!Number.isFinite(Date.parse(generatedAt)))throw new Error('Invalid performance card')
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560" viewBox="0 0 1000 560" role="img" aria-label="LaunchPier confirmed receipt accounting"><rect width="1000" height="560" rx="24" fill="#13171b"/><g font-family="Arial,sans-serif" fill="#e9eef2"><text x="48" y="64" font-size="18" fill="#b6c8da">LAUNCHPIER · CONFIRMED RECEIPT SAMPLE</text><text x="48" y="122" font-size="24">Realized P&amp;L · incomplete history</text><text x="48" y="204" font-size="58">Unavailable</text><text x="48" y="254" font-size="21">${summary.unknownSales} sales with unknown basis</text><text x="48" y="301" font-size="18" fill="#afbac5">Network fees: ${xml(formatEvidenceAmount(summary.networkFeeLamports,9,9))} SOL · ${summary.transactions} transactions</text><text x="48" y="350" font-size="18" fill="#afbac5">Actual confirmed cashflows and fees; sampled transaction coverage.</text><text x="48" y="383" font-size="18" fill="#afbac5">Missing transactions prevent verified acquisition basis and P&amp;L.</text><text x="48" y="449" font-size="15">${xml(mint)}</text><text x="48" y="491" font-size="15" fill="#afbac5">Generated ${xml(generatedAt)}</text></g></svg>`
}
export function downloadEvidence(content:string,type:string,filename:string):void{
 const href=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=href;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000)
}
