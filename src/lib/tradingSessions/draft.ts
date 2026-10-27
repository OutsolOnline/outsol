import {PublicKey} from '@solana/web3.js'
import {solLamports,validateSessionConfig} from './config'
import type {TradingSessionConfig} from './types'
import type {TradeStorage} from '../venues/tradeHistory'

export interface SessionForm {
 mode:TradingSessionConfig['mode'];action:'buy'|'sell';mint:string;creator:string;keyword:string;buySol:string;sellPercent:string
 maxTrades:string;intervalSeconds:string;durationSeconds:string;maxDebitSol:string;slippage:string;priorityFeeSol:string
 capDirection:'at-or-above'|'at-or-below';capSol:string
}
export const DEFAULT_SESSION_FORM:Readonly<SessionForm>={mode:'dca',action:'buy',mint:'',creator:'',keyword:'',buySol:'0.01',sellPercent:'25',maxTrades:'3',intervalSeconds:'20',durationSeconds:'180',maxDebitSol:'0.1',slippage:'5',priorityFeeSol:'0.0001',capDirection:'at-or-above',capSol:'100'}
export const SESSION_DRAFT_KEY='vanity-public-session-draft-v1'
export interface SessionDraftInput {form:SessionForm;walletId:string}
export interface SessionDraft extends SessionDraftInput {version:1}
export type SessionFormIssues=Partial<Record<keyof SessionForm,string>>

const isMode=(mode:unknown):mode is SessionForm['mode']=>mode==='dca'||mode==='cap'||mode==='new-launch'
export function sessionModeUrl(href:string,mode:SessionForm['mode']):string {
 if(!isMode(mode))throw new Error('Choose a supported session mode.')
 const url=new URL(href)
 url.searchParams.set('mode',mode)
 return `${url.pathname}${url.search}${url.hash}`
}
function target(storage?:TradeStorage):TradeStorage {
 if(storage)return storage
 try {if(typeof localStorage!=='undefined')return localStorage}catch{ /* Report a useful browser-storage error below. */ }
 throw new Error('Setup storage is unavailable. Check this browser’s storage permissions before leaving the page.')
}
function publicDraft(value:unknown):SessionDraft {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid public session draft.')
 const input=value as Record<string,unknown>,source=input.form
 if(!source||typeof source!=='object'||Array.isArray(source)||typeof input.walletId!=='string'||input.walletId.length>100)throw new Error('Invalid public session draft.')
 const candidate=source as Record<string,unknown>,form={} as SessionForm
 for(const key of Object.keys(DEFAULT_SESSION_FORM) as (keyof SessionForm)[]) {
  const limit=key==='keyword'?80:key==='mint'||key==='creator'?44:24
  if(typeof candidate[key]!=='string'||candidate[key].length>limit)throw new Error('Public setup contains an invalid or oversized field.')
  Object.assign(form,{[key]:candidate[key]})
 }
 if(!isMode(form.mode)||!['buy','sell'].includes(form.action)||!['at-or-above','at-or-below'].includes(form.capDirection))throw new Error('Unsupported public session setup.')
 return {version:1,form,walletId:input.walletId}
}

/** Incomplete form values are allowed; only these public fields ever reach storage. */
export function readSessionDraft(storage?:TradeStorage):SessionDraft|null {
 try {
  const raw=target(storage).getItem(SESSION_DRAFT_KEY)
  if(raw===null)return null
  if(raw.length>8000)throw new Error()
  const parsed:unknown=JSON.parse(raw)
  if(!parsed||typeof parsed!=='object'||!('version' in parsed)||parsed.version!==1)throw new Error()
  return publicDraft(parsed)
 }catch {throw new Error('Saved session setup cannot be read. Check browser storage access, or reset the saved setup to start fresh. Transaction recovery stays separate.')}
}
export function saveSessionDraft(input:SessionDraftInput,storage?:TradeStorage):void {
 const safe=publicDraft(input),destination=target(storage)
 readSessionDraft(destination) // Preserve unreadable or newer records until an explicit reset.
 try {
  const serialized=JSON.stringify(safe)
  destination.setItem(SESSION_DRAFT_KEY,serialized)
  if(destination.getItem(SESSION_DRAFT_KEY)!==serialized)throw new Error()
 }catch {throw new Error('Setup could not be saved in this browser. Keep this page open or retry saving before you leave.')}
}
export function clearSessionDraft(storage?:TradeStorage):void {
 try {const destination=target(storage);destination.removeItem(SESSION_DRAFT_KEY);if(destination.getItem(SESSION_DRAFT_KEY)!==null)throw new Error()}
 catch {throw new Error('Saved setup could not be reset. Check this browser’s storage permissions and try again.')}
}
export function restoreSessionDraft(draft:SessionDraft|null,mode?:unknown):SessionDraftInput {
 const safe=draft?publicDraft(draft):{form:{...DEFAULT_SESSION_FORM},walletId:''}
 return {form:{...safe.form,...(isMode(mode)?{mode}:{})},walletId:safe.walletId}
}
export function sessionFormIssues(form:SessionForm):SessionFormIssues {
 const issues:SessionFormIssues={},action=form.mode==='new-launch'?'buy':form.action
 const publicAddress=(field:'mint'|'creator',label:string)=>{try{new PublicKey(form[field].trim())}catch{issues[field]=`Enter a valid ${label} public address.`}}
 const integer=(field:'maxTrades'|'sellPercent'|'intervalSeconds'|'durationSeconds',min:number,max:number,label:string)=>{
  if(!/^\d+$/.test(form[field])||!Number.isSafeInteger(Number(form[field]))||Number(form[field])<min||Number(form[field])>max)issues[field]=`${label} must be a whole number from ${min} to ${max}.`
 }
 const decimal=(field:'slippage'|'priorityFeeSol',max:number,label:string)=>{
  if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(form[field])||!Number.isFinite(Number(form[field]))||Number(form[field])>max)issues[field]=`${label} must be between 0 and ${max}${field==='slippage'?'%':' SOL'}.`
 }
 const solAmount=(field:'buySol'|'maxDebitSol'|'capSol',label:string,max?:bigint)=>{
  try {const value=solLamports(form[field]);if(value<=0n||(max!==undefined&&value>max))throw new Error()}
  catch {issues[field]=`${label} must be a positive decimal SOL amount${max?' up to 1,000 SOL':''}, with at most nine places.`}
 }
 if(form.mode==='new-launch') {
  if(form.creator.trim())publicAddress('creator','creator')
  if(form.keyword.trim()&&(form.keyword.trim().length<3||form.keyword.trim().length>80))issues.keyword='Use a name or symbol keyword with 3–80 characters.'
  if(!form.creator.trim()&&!form.keyword.trim())issues.keyword='Set an exact creator address or a keyword with at least 3 characters.'
 } else publicAddress('mint','Pump.fun mint')
 if(action==='buy')solAmount('buySol','Buy amount',1_000_000_000_000n)
 else integer('sellPercent',1,100,'Sell percentage')
 if(form.mode!=='cap')integer('maxTrades',1,10,'Maximum trades')
 integer('intervalSeconds',form.mode==='new-launch'?20:5,300,form.mode==='dca'?'Wait between trades in seconds':'Poll interval in seconds')
 integer('durationSeconds',5,300,'Session duration in seconds')
 solAmount('maxDebitSol','Total wallet debit ceiling',1_000_000_000_000n)
 decimal('slippage',50,'Slippage');decimal('priorityFeeSol',0.01,'Priority fee ceiling')
 if(action==='buy'&&!issues.buySol&&!issues.maxDebitSol&&solLamports(form.buySol)>solLamports(form.maxDebitSol))issues.maxDebitSol='The total debit ceiling must cover at least one buy, plus network fees and rent reserves.'
 if(form.mode==='cap')solAmount('capSol','Market-cap target')
 return issues
}
export function sessionConfigFromForm(form:SessionForm,walletId:string,payer:string):TradingSessionConfig {
 const issue=Object.values(sessionFormIssues(form))[0]
 if(issue)throw new Error(issue)
 const action=form.mode==='new-launch'?'buy':form.action
 return validateSessionConfig({version:1,mode:form.mode,walletId,payer,action,mint:form.mint.trim(),creator:form.creator.trim(),keyword:form.keyword.trim(),buySol:action==='buy'?form.buySol:DEFAULT_SESSION_FORM.buySol,sellPercent:action==='sell'?Number(form.sellPercent):Number(DEFAULT_SESSION_FORM.sellPercent),maxTrades:form.mode==='cap'?1:Number(form.maxTrades),intervalMs:Number(form.intervalSeconds)*1000,durationMs:Number(form.durationSeconds)*1000,maxDebitSol:form.maxDebitSol,slippage:Number(form.slippage),priorityFeeSol:Number(form.priorityFeeSol),capDirection:form.capDirection,capSol:form.capSol})
}
