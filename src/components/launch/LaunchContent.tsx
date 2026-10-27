'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter,useSearchParams } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { FolderOpen, Save, ShieldCheck, Loader2, ArrowUpRight, FlaskConical } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { StepIndicator } from './StepIndicator'
import { ConnectWalletStep } from './steps/ConnectWalletStep'
import { MetadataStep } from './steps/MetadataStep'
import { SelectMintStep } from './steps/SelectMintStep'
import { LaunchSettingsStep } from './steps/LaunchSettingsStep'
import { SignSendStep } from './steps/SignSendStep'
import { ResultStep } from './steps/ResultStep'
import { useLaunchStore } from '@/stores/launchStore'
import { usePlatformWalletStore } from '@/stores/walletStore'
import { LaunchRecovery } from './LaunchRecovery'
import { launchSelectionFromSearch } from '@/lib/workspaceCatalog'
import { createLaunchDraft, saveLaunchDraft, loadLaunchDrafts, restoreLaunchDraft } from '@/lib/launchDrafts'
import { readPending } from '@/lib/launchHistory'
import { shouldStartNewLaunch,savedLaunchUrl } from '@/lib/launchFlow'
import { normalizePumpDesign } from '@/lib/pumpProductPolicy'
import { saveArtwork, getArtwork, artworkToDataUri } from '@/lib/artworkLibrary'
import { readTradePending } from '@/lib/venues/tradeHistory'
import { assertNoPendingWalletOperation } from '@/lib/walletOperations/history'
import { assertNoPendingGroupOperation } from '@/lib/walletGroups/history'
import { TokenPreview } from './TokenPreview'
import {prepareLaunchNavigation,setActiveDesignForNavigation} from '@/lib/launchNavigation'
import styles from './LaunchBuilder.module.css'

export function LaunchContent() {
  const router=useRouter()
  const { connected } = useWallet()
  const store = useLaunchStore(), platform = usePlatformWalletStore()
  const { hydrateWallet } = platform
  const { currentStep, setStep } = store
  const query = useSearchParams().toString()
  const [draftName, setDraftName] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('')
  const draftId = useRef<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [restored,setRestored]=useState(false),[savedAt,setSavedAt]=useState(''),[autosaveError,setAutosaveError]=useState('')
  const assetRef=useRef<{blob:Blob;id:string}|null>(null)
  const missingArtworkRef=useRef<string|undefined>(undefined)
  const session=useRef(0)
  const platformReady = !!platform.getPublicKey()
  const chosenReady = store.usePlatformWallet ? platformReady : connected
  useEffect(() => { if (!store.metadata) { draftId.current = undefined;setActiveDesignForNavigation(undefined);assetRef.current=null;missingArtworkRef.current=undefined;setSavedAt('');setAutosaveError('');setDraftName('') } }, [store.metadata])
  useEffect(() => { hydrateWallet() }, [hydrateWallet])
  useEffect(()=>{
    let active=true
    const revision=++session.current
    setRestored(false)
    void (async()=>{
      try{
        const current=useLaunchStore.getState(),params=new URLSearchParams(query)
        if((current.metadata&&!params.has('draft'))||(current.currentStep==='result'&&!params.has('draft'))||readPending())return
        const pointer=params.get('draft')||(!params.has('new')?localStorage.getItem('vanity-active-design-v1'):null)
        if(!pointer)return
        assertNoPendingWalletOperation();assertNoPendingGroupOperation()
        if(readTradePending())throw new Error('Check the pending trade in Activity before restoring your design.')
        const draft=loadLaunchDrafts().find(item=>item.id===pointer)
        if(!draft)throw new Error('The last saved design is unavailable. Open Library to choose a saved design.')
        const value=restoreLaunchDraft(draft)
        let image:Blob|null=null,preview:string|null=null,warning='',missingId:string|undefined
        if(value.artworkId){
          try{const artwork=await getArtwork(value.artworkId);if(artwork){image=artwork.blob;preview=await artworkToDataUri(artwork.blob)}else{missingId=value.artworkId;warning='The local artwork is missing. Your saved artwork reference is preserved; choose another image before launch.'}}
          catch{missingId=value.artworkId;warning='Artwork storage is unavailable. Your public design and artwork reference were restored. Retry Library or choose another image before launch.'}
        }
        if(!active||(!params.has('draft')&&useLaunchStore.getState().metadata)||readPending())return
        assertNoPendingWalletOperation();assertNoPendingGroupOperation();if(readTradePending())return
        missingArtworkRef.current=missingId;assetRef.current=image&&value.artworkId?{blob:image,id:value.artworkId}:null
        current.reset();draftId.current=draft.id;setActiveDesignForNavigation(draft.id);setDraftName(draft.name);setSavedAt(draft.updatedAt)
        current.setMetadata(value.metadata);current.setConfig(normalizePumpDesign(value.config));current.setBundleSettings(value.bundleSettings);current.setMetadataUri(value.metadataUri);current.setImageFile(image);current.setImagePreview(preview);current.setStep('metadata');current.setError(warning||null)
        setMessage('Your design was restored. Select a fresh mint and signing wallet when you continue; private keys are never saved with a design.')
      }catch(e){if(active)setError(e instanceof Error?e.message:'The saved design could not be restored.')}
      finally{if(active)setRestored(true)}
    })()
    return()=>{active=false;session.current=revision+1}
  },[query])
  useEffect(()=>{
    if(!restored||!store.metadata||store.currentStep==='result'||store.isLoading)return
    const snapshot={metadata:{...store.metadata},metadataUri:store.metadataUri||'',config:{...store.config},bundleSettings:structuredClone(store.bundleSettings),image:store.imageFile,name:draftName||store.metadata.name||'Untitled design'}
    const id=draftId.current||crypto.randomUUID();draftId.current=id
    let active=true
    const timer=setTimeout(()=>{void(async()=>{
      try{
        let artworkId=assetRef.current?.blob===snapshot.image?assetRef.current.id:!snapshot.image?missingArtworkRef.current:undefined
        if(snapshot.image&&!artworkId){const asset=await saveArtwork(snapshot.image,snapshot.name);artworkId=asset.id;assetRef.current={blob:snapshot.image,id:asset.id};missingArtworkRef.current=undefined}
        if(!active)return
        const draft=createLaunchDraft({...snapshot,...(artworkId?{artworkId}:{})},id)
        saveLaunchDraft(draft);setActiveDesignForNavigation(id);localStorage.setItem('vanity-active-design-v1',id)
        if(active){setSavedAt(draft.updatedAt);setAutosaveError('');const resume=savedLaunchUrl(query);if(resume)router.replace(resume,{scroll:false})}
      }catch(e){if(active)setAutosaveError(e instanceof Error?e.message:'Autosave is unavailable. Save or export your design before leaving.')}
    })()},800)
    return()=>{active=false;clearTimeout(timer)}
  },[restored,store.metadata,store.metadataUri,store.config,store.bundleSettings,store.imageFile,store.currentStep,store.isLoading,draftName,query,router])
  useEffect(() => {
    try {
      if (readPending()) return
      const current = useLaunchStore.getState()
      const params=new URLSearchParams(query)
      const needsFresh=shouldStartNewLaunch(current.currentStep,params)||(params.get('new')==='1'&&(!!current.metadata||!!current.imageFile||current.currentStep!=='metadata'))
      if(needsFresh){if(!prepareLaunchNavigation(`/launch?${query}`)){setError(useLaunchStore.getState().error||'The current operation must finish before starting another design.');return}draftId.current=undefined;setDraftName('');setMessage('');setError('')}
      current.setConfig(launchSelectionFromSearch(new URLSearchParams(query), Math.floor(Date.now() / 1000)))
      if (current.currentStep !== 'result') {
        const config = useLaunchStore.getState().config
        if (config.mode !== 'standard' || config.venue !== 'pump') { current.setConfig(normalizePumpDesign(config)); setMessage('This design now uses Pump.fun. Its previous developer-buy amount was reset; review the launch settings before signing.') }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Check your pending launch before continuing.') }
  }, [query])
  useEffect(() => { if (!chosenReady && currentStep === 'sign-send') setStep('connect-wallet') }, [chosenReady, currentStep, setStep])
  const save = async () => {
    if (saving) return
    setError(''); setMessage(''); setSaving(true)
    try {
      const snapshot = useLaunchStore.getState()
      const revision=session.current,id=draftId.current||crypto.randomUUID(),missingId=missingArtworkRef.current
      draftId.current=id
      const input = { name: draftName || snapshot.metadata?.name || 'Untitled design', metadata: snapshot.metadata ? { ...snapshot.metadata } : { name: '', symbol: '', description: '' }, metadataUri: snapshot.metadataUri || '', config: { ...snapshot.config },bundleSettings:structuredClone(snapshot.bundleSettings) }
      const artwork = snapshot.imageFile ? await saveArtwork(snapshot.imageFile, input.name) : null
      if(session.current!==revision||draftId.current!==id)return
      const draft = createLaunchDraft({ ...input, ...(artwork ? { artworkId: artwork.id } : missingId ? {artworkId:missingId} : {}) }, id)
      saveLaunchDraft(draft); draftId.current = draft.id;setActiveDesignForNavigation(draft.id); setMessage(artwork ? 'Design and artwork saved on this device. Wallet and mint keys are excluded.' : 'Public design saved on this device. Wallet and mint keys are excluded.')
      localStorage.setItem('vanity-active-design-v1',draft.id);setSavedAt(draft.updatedAt);const resume=savedLaunchUrl(query);if(resume)router.replace(resume,{scroll:false})
    } catch (e) { setError(e instanceof Error ? e.message : 'Draft could not be saved.') }
    finally { setSaving(false) }
  }
  const designing = ['metadata','select-mint','launch-settings'].includes(store.currentStep)
  return <div className="min-h-screen flex flex-col"><Header /><main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
    <div className="page-heading"><div className="flex flex-wrap items-center justify-between gap-5"><div><h1>New launch</h1><p>Design, prepare and review your Pump.fun token.</p></div><div className="flex flex-wrap gap-3"><Link href="/rehearse" className="secondary-action"><FlaskConical size={16}/>Rehearse</Link><Link href="/library" className="secondary-action"><FolderOpen size={16} />Library</Link></div></div></div>
    <LaunchRecovery />
    <div className={styles.builder}><div className={styles.builderTop}><span className={styles.builderTag}>Pump.fun token</span><span role="status">{autosaveError?'Autosave paused':savedAt?`Saved ${new Date(savedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'Saved on this device as you work'}</span></div>
    <div className={styles.builderBody}><StepIndicator currentStep={store.currentStep} /><div className={store.currentStep==='sign-send'||store.currentStep==='result'?styles.stepBody:`${styles.stepBody} ${styles.metadataGrid}`}><div key={`${store.currentStep}:${store.config.mode}:${store.config.venue}`}>
      {!restored ? <div className={styles.editorSkeleton} role="status" aria-label="Restoring your saved design"><span/><span/><span/></div> : store.currentStep === 'metadata' ? <MetadataStep /> : store.currentStep === 'select-mint' ? <SelectMintStep /> : store.currentStep === 'launch-settings' ? <LaunchSettingsStep /> : store.currentStep === 'connect-wallet' ? <ConnectWalletStep /> : store.currentStep === 'sign-send' ? <SignSendStep /> : <ResultStep />}
    </div>{store.currentStep!=='sign-send'&&store.currentStep!=='result'&&<TokenPreview/>}</div></div>
    {designing && <div className={styles.draftBar}><div><Save size={16} /><label htmlFor="draft-name">Save your progress</label></div><input id="draft-name" maxLength={80} placeholder="Design name" value={draftName} disabled={saving} onChange={e => setDraftName(e.target.value)} /><button className="secondary-action" disabled={saving} onClick={save}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{saving ? 'Saving…' : 'Save design'}</button></div>}
    </div>{(error || (designing && store.error)) && <p role="alert" className="notice notice-error mt-5">{error || store.error}</p>}{message && <p role="status" className="notice mt-5">{message} <Link href="/drafts" className="underline inline-flex gap-1 items-center">View designs<ArrowUpRight size={13} /></Link></p>}
    {autosaveError&&<p role="alert" className="notice notice-error mt-5">Autosave paused: {autosaveError} Your current work remains on this screen. Open Library to export a saved copy.</p>}
    <div className={styles.builderFoot}><span><ShieldCheck size={13} />Private keys stay on your device.</span><span>0% OutSol fee. Network, account rent and third-party charges are separate.</span></div>
  </main><Footer /></div>
}
