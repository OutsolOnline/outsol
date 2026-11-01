'use client'
import {create} from 'zustand'
import {MAX_SNIPER_PAIR_RECORD_BYTES,SNIPER_PAIRS_KEY,parseSniperPairRecord,sniperPairId,sniperPairName,validateSniperPairInput,validateSniperPairs,type SniperPair,type SniperPairInput,type SniperPairRecord,type SniperPairStorage} from '@/lib/sniperPairs/catalog'

export interface SniperPairState {
 hydrated:boolean;pairs:SniperPair[];revision:number;storageUnavailable:boolean;error:string|null
 hydrate():void;addPairs(inputs:readonly SniperPairInput[]):SniperPair[];renamePair(id:string,name:string):void;removePair(id:string):void
}
interface Options {storage?:SniperPairStorage;listen?:boolean}
/** Public, synchronous catalog writes use a checked disk snapshot. Private
 * wallet creation and encryption remain entirely in the wallet-library store. */
export function createSniperPairStore(options:Options={}){
 let record:SniperPairRecord={version:1,revision:0,pairs:[]},raw:string|null=null,writing=false
 const destination=():SniperPairStorage=>{if(options.storage)return options.storage;if(typeof localStorage==='undefined')throw new Error('Sniper pair storage is unavailable.');return localStorage}
 const store=create<SniperPairState>((set,get)=>{
  const apply=(next:SniperPairRecord,nextRaw:string|null)=>{record=structuredClone(next);raw=nextRaw;set({pairs:structuredClone(next.pairs),revision:next.revision,hydrated:true,storageUnavailable:false,error:null})}
  const failed=(reason:unknown,unavailable=false)=>{const error=reason instanceof Error?reason:new Error('Sniper pairs could not be saved.');set({error:error.message,...(unavailable?{storageUnavailable:true}:{})});return error}
  const load=()=>{try{const current=destination().getItem(SNIPER_PAIRS_KEY);apply(parseSniperPairRecord(current),current)}catch(reason){set({hydrated:true});failed(reason,true)}}
  const ready=()=>{if(!get().hydrated)load();if(get().storageUnavailable)throw new Error('Sniper pair storage is unavailable. Preserve browser data and wallet backups before continuing.')}
  const mutate=<T,>(change:(pairs:SniperPair[])=>{pairs:SniperPair[];value:T}):T=>{
   ready();if(writing)throw new Error('Finish the current pair change first.');writing=true
   try{
    const disk=destination();if(disk.getItem(SNIPER_PAIRS_KEY)!==raw)throw new Error('Sniper pairs changed in another tab. Reload this page before making changes.')
    const changed=change(structuredClone(record.pairs)),next:SniperPairRecord={version:1,revision:record.revision+1,pairs:validateSniperPairs(changed.pairs)}
    if(!Number.isSafeInteger(next.revision))throw new Error('The saved pair revision is invalid. Preserve browser storage.')
    const encoded=JSON.stringify(next);if(encoded.length>MAX_SNIPER_PAIR_RECORD_BYTES)throw new Error('The saved pair collection is too large.')
    disk.setItem(SNIPER_PAIRS_KEY,encoded);if(disk.getItem(SNIPER_PAIRS_KEY)!==encoded)throw new Error('Sniper pair storage could not be saved. Preserve browser data before continuing.')
    apply(next,encoded);return structuredClone(changed.value)
   }catch(reason){throw failed(reason)}finally{writing=false}
  }
  return{
   hydrated:false,pairs:[],revision:0,storageUnavailable:false,error:null,
   hydrate:()=>{if(!get().hydrated||get().storageUnavailable)load()},
   addPairs:inputs=>mutate(pairs=>{
    if(!Array.isArray(inputs)||!inputs.length||inputs.length>50)throw new Error('Add between one and 50 reusable sniper pairs.')
    const createdAt=new Date().toISOString(),added=inputs.map(input=>({...validateSniperPairInput(input),id:crypto.randomUUID(),createdAt}))
    return{pairs:[...pairs,...added],value:added}
   }),
   renamePair:(id,name)=>{mutate(pairs=>{const identity=sniperPairId(id),nextName=sniperPairName(name);if(!pairs.some(pair=>pair.id===identity))throw new Error('This pair no longer exists.');return{pairs:pairs.map(pair=>pair.id===identity?{...pair,name:nextName}:pair),value:undefined}})},
   removePair:id=>{mutate(pairs=>{const identity=sniperPairId(id);if(!pairs.some(pair=>pair.id===identity))throw new Error('This pair no longer exists.');return{pairs:pairs.filter(pair=>pair.id!==identity),value:undefined}})},
  }
 })
 if(options.listen!==false&&typeof window!=='undefined'&&typeof window.addEventListener==='function')window.addEventListener('storage',event=>{
  if(event.key!==null&&event.key!==SNIPER_PAIRS_KEY)return
  if(event.key===SNIPER_PAIRS_KEY&&event.newValue===raw)return
  // Hydration after a cross-tab edit is a read only action. Never repair or
  // overwrite corrupt data, and keep the last public snapshot for recovery.
  try{const current=destination().getItem(SNIPER_PAIRS_KEY),next=parseSniperPairRecord(current);record=structuredClone(next);raw=current;store.setState({pairs:structuredClone(next.pairs),revision:next.revision,hydrated:true,storageUnavailable:false,error:null})}
  catch(reason){store.setState({hydrated:true,storageUnavailable:true,error:reason instanceof Error?reason.message:'Sniper pair storage is unavailable.'})}
 })
 return store
}
export const useSniperPairStore=createSniperPairStore()
