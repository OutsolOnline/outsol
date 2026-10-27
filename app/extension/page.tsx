'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {ArrowDownToLine,ArrowRight,Check,ExternalLink,FileImage,Globe,Loader2,MousePointer2,Puzzle,ShieldCheck,Upload,X} from 'lucide-react'
import {Header} from '@/components/layout/Header'
import {Footer} from '@/components/layout/Footer'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Textarea} from '@/components/ui/textarea'
import {parseWebCapture,publicCaptureUrl,createCapturedDraft,captureMetadata,fetchCaptureImage,readCaptureReview,writeCaptureReview,clearCaptureReview,verifyCaptureReviewDraft,type WebCapture} from '@/lib/webCapture'
import {getArtwork,saveArtwork,validateArtwork} from '@/lib/artworkLibrary'
import {saveLaunchDraft} from '@/lib/launchDrafts'
import {prepareLaunchLinkNavigation} from '@/lib/launchNavigation'
import {useLaunchStore} from '@/stores/launchStore'
import type {TokenMetadata} from '@/lib/pumpfun/types'
import styles from './page.module.css'

export default function ExtensionPage(){
 const [capture,setCapture]=useState<WebCapture|null>(null),[metadata,setMetadata]=useState<TokenMetadata>({name:'',symbol:'',description:'',website:'',twitter:'',telegram:''})
 const [manualUrl,setManualUrl]=useState(''),[image,setImage]=useState<Blob|null>(null),[imagePreview,setImagePreview]=useState(''),[artworkId,setArtworkId]=useState(''),[busy,setBusy]=useState<'import'|'image'|'save'|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[savedId,setSavedId]=useState(''),[savedVerified,setSavedVerified]=useState(false),[ready,setReady]=useState(false)
 const epoch=useRef(0),alive=useRef(true),controller=useRef<AbortController|null>(null),previewRef=useRef(''),working=useRef<number|null>(null)
 const nameBytes=new TextEncoder().encode(metadata.name.trim()).length
 const update=(patch:Partial<TokenMetadata>)=>{setMetadata(value=>({...value,...patch}));setSavedId('');setError('')}
 const clearImage=useCallback(()=>{if(previewRef.current)URL.revokeObjectURL(previewRef.current);previewRef.current='';setImagePreview('');setImage(null);setArtworkId('')},[])
 const accept=useCallback((value:WebCapture)=>{epoch.current++;controller.current?.abort();working.current=null;setBusy(null);clearImage();setCapture(value);setMetadata(captureMetadata(value));setSavedId('');setError('');setNotice('')},[clearImage])
 const attach=useCallback((blob:Blob,localId='')=>{if(previewRef.current)URL.revokeObjectURL(previewRef.current);const url=URL.createObjectURL(blob);previewRef.current=url;setImage(blob);setImagePreview(url);setArtworkId(localId)},[])
 const close=()=>{epoch.current++;controller.current?.abort();working.current=null;setBusy(null);clearImage();setCapture(null);setError('');setNotice('');setSavedId('');try{clearCaptureReview()}catch{setNotice('The browser could not clear refresh recovery. Close this tab to discard its temporary capture.')}}
 useEffect(()=>{
  alive.current=true
  const read=()=>{if(!window.location.hash)return;try{const value=parseWebCapture(window.location.hash);if(value)accept(value)}catch(e){setError(e instanceof Error?e.message:'The captured details could not be read.')}finally{window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search)}}
  if(window.location.hash)read()
  else try{
   const storedReview=readCaptureReview()
   if(storedReview){
    const recovery=verifyCaptureReviewDraft(storedReview),review=recovery.review
    accept(review.capture);setMetadata(review.metadata);setSavedId(review.savedId||'');setSavedVerified(recovery.savedDraftStatus==='saved');setNotice(recovery.warning||'Your capture review was restored in this tab. Images are recovered only after they have been saved locally.')
    if(review.artworkId){setArtworkId(review.artworkId);const current=++epoch.current;working.current=current;setBusy('image');void getArtwork(review.artworkId).then(asset=>{if(!alive.current||epoch.current!==current)return;if(asset)attach(asset.blob,asset.id);else{setArtworkId('');setNotice('The saved artwork is no longer available. Choose an image again; existing launch drafts are preserved.')}}).catch(e=>{if(alive.current&&epoch.current===current)setError(`The saved artwork could not be restored. Its recovery reference is preserved. ${e instanceof Error?e.message:'Try again when local storage is available.'}`)}).finally(()=>{if(working.current===current){working.current=null;if(alive.current)setBusy(null)}})}
   }
  }catch(e){setError(e instanceof Error?e.message:'The saved capture could not be restored.')}
  setReady(true);window.addEventListener('hashchange',read)
  return()=>{alive.current=false;controller.current?.abort();if(previewRef.current)URL.revokeObjectURL(previewRef.current);window.removeEventListener('hashchange',read)}
 },[accept,attach])
 useEffect(()=>{if(ready&&capture)try{writeCaptureReview({capture,metadata,...(artworkId?{artworkId}:{}),...(savedId?{savedId}:{})})}catch(e){setNotice(e instanceof Error?e.message:'Refresh recovery is unavailable. Keep this tab open until the draft is saved.')}},[ready,capture,metadata,artworkId,savedId])
 const finish=(current:number)=>{if(working.current===current){working.current=null;controller.current=null;if(alive.current)setBusy(null)}}
 const chooseImage=async(file:File)=>{
  if(working.current!==null)return;const current=++epoch.current;working.current=current;setBusy('image');setError('')
  try{await validateArtwork(file);if(alive.current&&epoch.current===current){attach(file);setSavedId('');setNotice('')}}catch(e){if(alive.current&&epoch.current===current)setError(e instanceof Error?e.message:'This image could not be read. Choose another image.')}finally{finish(current)}
 }
 const importImage=async()=>{
  if(working.current!==null||!capture?.imageUrl)return;const current=++epoch.current;working.current=current;setBusy('import');setError('');setNotice('');controller.current=new AbortController()
  try{const blob=await fetchCaptureImage(capture.imageUrl,controller.current.signal);await validateArtwork(blob);if(alive.current&&epoch.current===current){attach(blob);setSavedId('')}}catch(e){if(alive.current&&epoch.current===current)setError(e instanceof Error&&e.name==='AbortError'?'The image import timed out. Try again or download the image and choose it here.':e instanceof Error&&!(e instanceof TypeError)?e.message:'This website blocked image import. Download the image and choose it here.')}finally{finish(current)}
 }
 const cancelImport=()=>{epoch.current++;controller.current?.abort();controller.current=null;working.current=null;setBusy(null);setNotice('Image import canceled. Your current artwork and details are preserved.')}
 const save=async()=>{
  if(working.current!==null||!capture)return;const current=++epoch.current;working.current=current;setBusy('save');setError('');setNotice('')
  try{const draft=createCapturedDraft(capture,metadata);const artwork=image?await saveArtwork(image,draft.metadata.name):null;if(!alive.current||epoch.current!==current)return;if(artwork)setArtworkId(artwork.id);saveLaunchDraft({...draft,...(artwork?{artworkId:artwork.id}:{})});setMetadata(draft.metadata);setSavedId(draft.id);setSavedVerified(true)}catch(e){if(alive.current&&epoch.current===current)setError(e instanceof Error?e.message:'The draft could not be saved. Your current details are preserved.')}finally{finish(current)}
 }
 const manual=()=>{try{accept({version:1,kind:'page',name:'',symbol:'',description:'',sourceUrl:publicCaptureUrl(manualUrl)})}catch(e){setError(e instanceof Error?e.message:'Enter a public HTTPS page URL.')}}
 return <div className="min-h-screen flex flex-col"><Header/><main id="workspace-content" tabIndex={-1} className="workspace-main flex-1">
  {error&&<div role="alert" className="notice notice-error mb-6">{error}</div>}
  {notice&&<p role="status" className="notice mb-6">{notice}</p>}
  {capture?<>
   <div className="page-heading flex flex-wrap justify-between gap-5"><div><div className="eyebrow">CAPTURED IDEA</div><h1>Make it your next token.</h1><p>Review the suggestions. Your launch stays in your control.</p></div><Button variant="ghost" disabled={busy==='save'} onClick={close}><X size={15}/>Close capture</Button></div>
   <div className={styles.reviewGrid} aria-busy={Boolean(busy)}>
    <section className="workspace-card">
     <div className={styles.source}><Globe size={18}/><div><span className="field-label">Source reference</span><a href={capture.sourceUrl} target="_blank" rel="noreferrer" className="text-sm break-all text-accent">{capture.sourceUrl}<ExternalLink className="inline ml-2" size={12}/></a></div></div>
     <p className="field-help mt-4">Web content is a suggestion. Your text stays in this tab across refresh. Save the draft to keep artwork too. Nothing has been published or signed.</p>
     <fieldset disabled={Boolean(busy)} className="space-y-5 mt-7">
      <div className="grid sm:grid-cols-2 gap-4">
       <div><label className="field-label" htmlFor="capture-name">Token name · 32 UTF-8 bytes</label><Input id="capture-name" value={metadata.name} onChange={e=>update({name:e.target.value})} maxLength={64} aria-describedby="capture-name-count" aria-invalid={nameBytes>32}/><p id="capture-name-count" className={`field-help mt-2 ${nameBytes>32?'text-red-400':''}`}>{nameBytes}/32 bytes{nameBytes>32?' · Shorten the name to save this draft.':''}</p></div>
       <div><label className="field-label" htmlFor="capture-symbol">Symbol · up to 10 characters</label><Input id="capture-symbol" value={metadata.symbol} onChange={e=>update({symbol:e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')})} maxLength={10}/></div>
      </div>
      <div><label className="field-label" htmlFor="capture-description">Description</label><Textarea id="capture-description" value={metadata.description} maxLength={1000} rows={6} onChange={e=>update({description:e.target.value})}/><p className="field-help mt-2">{metadata.description.length}/1,000 characters</p></div>
      <details className="border-t border-border pt-5"><summary className="text-sm cursor-pointer">Website and social links · optional</summary><div className="space-y-4 mt-5">{(['website','twitter','telegram'] as const).map(key=><div key={key}><label htmlFor={`capture-${key}`} className="field-label capitalize">{key==='twitter'?'X / Twitter':key}</label><Input type="url" id={`capture-${key}`} placeholder="https://" maxLength={300} value={metadata[key]} onChange={e=>update({[key]:e.target.value})}/></div>)}</div></details>
     </fieldset>
    </section>
    <aside className={styles.summary}>
     <section className="workspace-card">
      <h2 className="text-lg">Artwork</h2>
      <div className={styles.artwork}>{imagePreview?<img src={imagePreview} alt="Selected token artwork" onError={()=>{epoch.current++;controller.current?.abort();working.current=null;setBusy(null);clearImage();setSavedId('');setError('This image could not be displayed. Choose another PNG, JPEG, WebP or GIF.')}}/>:<><FileImage size={30}/><p>{busy==='image'?'Checking artwork…':'Add your token artwork'}</p></>}</div>
      <label className="secondary-action cursor-pointer w-full justify-center focus-within:ring-2 focus-within:ring-accent" aria-disabled={Boolean(busy)}><Upload size={15}/>Choose image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={Boolean(busy)} className="sr-only" aria-label="Choose captured token artwork" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void chooseImage(file)}}/></label>
      {image&&<Button variant="ghost" className="w-full mt-2" disabled={Boolean(busy)} onClick={()=>{clearImage();setSavedId('');setError('');setNotice('')}}><X size={14}/>Remove image</Button>}
      <p className="field-help mt-3">PNG, JPEG, WebP or GIF · up to 5 MB. Saved locally with the draft.</p>
      {capture.imageUrl&&<div className="mt-5 border-t border-border pt-5"><p className="text-sm text-muted leading-6">The source included an image reference. Importing requests it directly from that website, without cookies.</p><Button variant="secondary" className="mt-4 w-full" disabled={Boolean(busy)} onClick={()=>void importImage()}>{busy==='import'?<Loader2 size={15} className="animate-spin"/>:<ArrowDownToLine size={15}/>} {busy==='import'?'Importing image…':'Import referenced image'}</Button>{busy==='import'&&<Button variant="ghost" className="mt-2 w-full" onClick={cancelImport}>Cancel image import</Button>}<a href={capture.imageUrl} target="_blank" rel="noreferrer" className="text-link mt-3 text-xs">Open original image<ExternalLink size={12}/></a></div>}
     </section>
     <section className="workspace-card mt-5">
      <h2 className="text-lg">Ready when you are.</h2><p className="text-sm text-muted leading-6 mt-3">Save a separate draft, then choose a fresh mint, wallet and first-buy settings in the builder.</p><dl className={styles.cost}><div><dt>Destination</dt><dd>Pump.fun · Solana</dd></div><div><dt>OutSol platform fee</dt><dd>0%</dd></div></dl>
      {savedId?<><p role="status" className="notice mt-4">{savedVerified&&<Check size={15} className="inline mr-2"/>}{savedVerified?'Draft saved on this device.':'Saved draft reference preserved. Its data could not be verified.'}</p><Link className="primary-action mt-4 w-full justify-center" href={`/launch?draft=${savedId}`} onClick={event=>{if(busy||!prepareLaunchLinkNavigation(event,'/launch?new=1')){event.preventDefault();if(!busy)setError(useLaunchStore.getState().error||'Save your current design or check pending transactions before opening this draft.')}}} aria-disabled={Boolean(busy)}>Open token builder<ArrowRight size={16}/></Link></>:<Button className="w-full mt-5" disabled={Boolean(busy)||!metadata.name.trim()||nameBytes>32||!metadata.symbol.trim()} onClick={()=>void save()}>{busy==='save'?<Loader2 size={16} className="animate-spin"/>:<Check size={16}/>} {busy==='save'?'Saving draft…':'Save launch draft'}</Button>}
      <p className="field-help mt-4">Network, account rent and protocol charges are reviewed before signing. Existing projects are preserved.</p>
     </section>
    </aside>
   </div>
  </>:<>
   <div className={styles.hero}><div><span className="eyebrow">OUTSOL FOR YOUR BROWSER</span><h1>Find the idea.<br/><span>Bring it to OutSol.</span></h1><p>Turn selected text, a page or an image reference into a reviewed Pump.fun launch draft—from the websites you use.</p><a className="primary-action" href="/downloads/outsol-extension.zip" download="outsol-extension.zip"><ArrowDownToLine size={17}/>Download for Chrome & Edge</a><span className={styles.release}>Free download · Manifest V3 · Manual installation</span></div><div className={styles.extensionCard}><div className={styles.browserBar}><i/><i/><i/><span>Your next idea</span></div><div className={styles.captureIllustration}><div className={styles.selectionLine}/><div className={styles.selectionLine}/><div className={styles.contextMenu}><img src="/favicon.svg" alt=""/><span>Prepare with OutSol</span><MousePointer2 size={16}/></div></div><div className={styles.transfer}><Puzzle size={20}/><span>Capture → Review → Launch</span><ShieldCheck size={20}/></div></div></div>
   <div className={styles.benefits}>{[[MousePointer2,'Capture on your terms','Click the toolbar icon or right-click a selection, image or page. Edit the details before opening OutSol.'],[ShieldCheck,'Your wallet stays in OutSol','The extension contains no wallets, private keys, RPC credentials or transaction signing.'],[Globe,'One tab at a time','Temporary access follows your click. No passive browsing collection or permanent all-sites access.']].map(([Icon,title,copy])=>{const I=Icon as typeof Globe;return <section className="workspace-card" key={String(title)}><I size={21} className="text-accent"/><h2 className="text-lg mt-5">{String(title)}</h2><p className="text-sm text-muted leading-6 mt-3">{String(copy)}</p></section>})}</div>
   <section className="workspace-card mt-7"><div className="flex flex-wrap justify-between gap-6"><div><div className="eyebrow">GET SET UP</div><h2 className="text-xl mt-2">Four steps. Then it’s in your toolbar.</h2><p className="text-sm text-muted mt-3">This download is an unpacked extension. A Chrome Web Store listing is not published.</p></div><a href="https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked" target="_blank" rel="noreferrer" className="text-link text-sm">Chrome installation guide<ExternalLink size={13}/></a></div><ol className={styles.steps}><li><b>01</b><h3>Download & extract</h3><p>Extract the ZIP into a folder you can keep.</p></li><li><b>02</b><h3>Open extensions</h3><p>Visit <code>chrome://extensions</code> or <code>edge://extensions</code>.</p></li><li><b>03</b><h3>Enable Developer mode</h3><p>Choose Load unpacked and select the extracted folder.</p></li><li><b>04</b><h3>Pin OutSol</h3><p>Open a public HTTPS website and click OutSol in the toolbar.</p></li></ol><p className="field-help mt-6">Browser settings, extension stores and protected pages cannot be captured. Image import depends on the source website’s permissions.</p><p className="field-help mt-3">The extension opens outsol.online. Wallets and drafts are local to each browser and site address. Create or import your wallets in the <Link href="/wallet" className="text-accent underline">wallet workspace</Link>; keep existing browser data and private backups safe.</p></section>
   <section className="workspace-card mt-7"><h2 className="text-xl">Already have a page or post in mind?</h2><p className="text-sm text-muted mt-3">Paste a public link and prepare the details manually. X monitoring is <Link href="/tracker" className="text-accent underline">Coming soon</Link>.</p><form className="flex flex-wrap gap-3 mt-5" onSubmit={e=>{e.preventDefault();manual()}}><label className="sr-only" htmlFor="manual-capture-source">Public page or post URL</label><Input id="manual-capture-source" className="flex-1 min-w-0 sm:min-w-[250px]" type="url" placeholder="https://" value={manualUrl} onChange={e=>setManualUrl(e.target.value)} required/><Button type="submit" variant="secondary">Prepare from link<ArrowRight size={15}/></Button></form></section>
  </>}
 </main><Footer/></div>
}
