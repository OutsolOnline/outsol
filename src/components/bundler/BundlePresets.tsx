'use client'
import {useEffect,useState} from 'react'
import {Button,Input,Label} from '@/components/ui'
import {useBundlerStore} from '@/stores/bundlerStore'
import {BUNDLE_PRESETS_KEY,BUILT_IN_BUNDLE_PRESETS,publicBundleSettings,readBundlePresets,writeBundlePresets,type BundlePreset} from '@/lib/bundler/presets'

export function BundlePresets(){
 const store=useBundlerStore(),[presets,setPresets]=useState<BundlePreset[]>([]),[raw,setRaw]=useState<string|null>(null),[ready,setReady]=useState(false),[selected,setSelected]=useState(''),[name,setName]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const reload=()=>{try{const loaded=readBundlePresets(localStorage);setPresets(loaded.presets);setRaw(loaded.raw);setReady(true);setError('')}catch(error){setReady(false);setError(error instanceof Error?error.message:'Preset storage is unavailable. Browser data has been preserved.')}}
 useEffect(()=>{reload();const changed=(event:StorageEvent)=>{if(event.key===BUNDLE_PRESETS_KEY||event.key===null)reload()};window.addEventListener('storage',changed);return ()=>window.removeEventListener('storage',changed)},[])
 const commit=(next:BundlePreset[],id:string,message:string)=>{
  try{const saved=writeBundlePresets(localStorage,next,raw);setPresets(saved.presets);setRaw(saved.raw);setSelected(id);setError('');setNotice(message)}catch(error){setError(error instanceof Error?error.message:'Preset save failed. Reload and try again.');setNotice('')}
 }
 const chosen=presets.find(preset=>preset.id===selected),disabled=store.isExecuting||!!store.result?.createSignature||!!store.result?.bundleId
 return <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-border bg-surface p-4">
  <div><h3 className="text-sm font-medium text-foreground">Execution presets</h3><p className="mt-1 text-xs text-muted">Pump.fun · SOL · 0% OutSol platform fee. Presets set budgets and timing; select and fund your own wallets.</p></div>
  <div className="grid gap-3 md:grid-cols-3">{BUILT_IN_BUNDLE_PRESETS.map(preset=><button id={`bundle-preset-${preset.id}`} key={preset.id} type="button" onClick={()=>{store.applyPreset(preset.settings);setNotice(`${preset.name} settings applied. Review all budgets before launch.`)}} className="scroll-mt-28 space-y-2 rounded-lg border border-border bg-background p-3 text-left hover:border-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4"><div className="text-sm font-medium text-foreground">{preset.name}</div><div className="text-xs text-accent">{preset.settings.wallets.length} buyer rows · {preset.settings.wallets.reduce((sum,wallet)=>sum+wallet.buyAmount,0).toFixed(2)} SOL buyer budget</div><p className="text-xs text-muted">{preset.description}</p></button>)}</div>
  <p className="text-xs text-muted">These styles coordinate your own public wallet activity. Browser timers may run late and stop when the page closes. Atomic bundles have no first-block or landing guarantee.</p>
  <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="bundle-preset-name">Preset name</Label><Input id="bundle-preset-name" maxLength={80} value={name} onChange={event=>setName(event.target.value)} placeholder="My launch settings"/></div><div className="space-y-1"><Label htmlFor="bundle-saved-preset">Saved presets</Label><select id="bundle-saved-preset" value={selected} onChange={event=>{const id=event.target.value;setSelected(id);setName(presets.find(preset=>preset.id===id)?.name??'')}} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">Choose a preset</option>{presets.map(preset=><option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></div></div>
  <div className="flex flex-wrap gap-2">
   <Button size="sm" variant="secondary" disabled={!ready||!name.trim()} onClick={()=>{try{const now=new Date().toISOString(),preset={id:crypto.randomUUID(),name:name.trim(),createdAt:now,updatedAt:now,settings:publicBundleSettings(store)};commit([...presets,preset],preset.id,'Public settings saved.')}catch(error){setError(error instanceof Error?error.message:'Preset cannot be saved.')}}}>Save current</Button>
   <Button size="sm" variant="secondary" disabled={!chosen} onClick={()=>{if(chosen){store.applyPreset(chosen.settings);setNotice(`${chosen.name} settings loaded. Wallet selection stays in this session.`)}}}>Load</Button>
   <Button size="sm" variant="secondary" disabled={!ready||!chosen||!name.trim()} onClick={()=>{if(chosen)commit(presets.map(preset=>preset.id===chosen.id?{...preset,name:name.trim(),updatedAt:new Date().toISOString()}:preset),chosen.id,'Preset renamed.')}}>Rename</Button>
   <Button size="sm" variant="secondary" disabled={!ready||!chosen} onClick={()=>{if(chosen){const now=new Date().toISOString(),copy={...chosen,id:crypto.randomUUID(),name:`${chosen.name.slice(0,73)} copy`,createdAt:now,updatedAt:now};commit([...presets,copy],copy.id,'Preset duplicated.');setName(copy.name)}}}>Duplicate</Button>
   <Button size="sm" variant="secondary" disabled={!ready||!chosen} onClick={()=>{if(chosen)commit(presets.filter(preset=>preset.id!==chosen.id),'','Preset removed.')}}>Remove</Button>
   <Button size="sm" variant="secondary" onClick={reload}>Reload presets</Button>
  </div>
  <p className="text-xs text-muted">Only public budgets, counts and timing settings are saved. Keys, wallet addresses, library selections, mint secrets and artwork are excluded.</p>
  {error&&<p role="alert" className="text-xs text-red-400">{error}</p>}{notice&&<p role="status" className="text-xs text-accent">{notice}</p>}
 </fieldset>
}
