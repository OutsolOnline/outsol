'use client'

import {useEffect,useMemo,useRef,useState} from 'react'
import {ArrowRight,Check,Copy,Plus,Trash2,Wallet} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {CreateManagedWallets} from '@/components/wallet/CreateManagedWallets'
import {ImportManagedWallets} from '@/components/wallet/ImportManagedWallets'
import {useWalletLibraryStore} from '@/stores/walletLibraryStore'
import {useSniperPairStore} from '@/stores/sniperPairStore'
import {useBundlerStore} from '@/stores/bundlerStore'
import {useLaunchStore} from '@/stores/launchStore'
import {usePlatformWalletStore} from '@/stores/walletStore'
import {resolveSniperPairs,type ResolvedSniperPair} from '@/lib/sniperPairs/catalog'
import {applySniperPairsToLaunch,createSniperPairScope} from '@/lib/sniperPairs/launch'
import {GenerateSniperSession,SniperSessionTools} from './SniperSessionTools'
import {SniperPairOperations} from './SniperPairOperations'
import {WorkspaceDisclosure} from '@/components/ui/WorkspaceDisclosure'
import {clearSniperSession,readSniperSessionPublicState,sniperSessionSelectionKey,sniperSessionProfileKey} from '@/lib/sniperPairs/sessionLifecycle'
import styles from './SniperPairsWorkspace.module.css'

type Mode='standalone'|'launch'
const selectionKey=sniperSessionSelectionKey
const profileKey=sniperSessionProfileKey
export function SniperPairsWorkspace({mode,creatorAddress,onBusyChange,lockedPairIds}:{mode:Mode;creatorAddress?:string|null;onBusyChange?:(busy:boolean)=>void;lockedPairIds?:readonly string[]}){
 const library=useWalletLibraryStore(),catalog=useSniperPairStore(),bundle=useBundlerStore(),launch=useLaunchStore(),platform=usePlatformWalletStore()
 const [selected,setSelected]=useState<string[]>([]),[ready,setReady]=useState(false),[name,setName]=useState('My sniper session'),[deployerId,setDeployerId]=useState('')
 const [restoredDeployerAddress,setRestoredDeployerAddress]=useState('')
 const [allowDefaultDeployer,setAllowDefaultDeployer]=useState(true),[clearing,setClearing]=useState(false),[generatorVersion,setGeneratorVersion]=useState(0)
 const sessionMutation=useRef(false),viewEpoch=useRef({value:0})
 useEffect(()=>{const view=viewEpoch.current,epoch=++view.value;return()=>{if(view.value===epoch)view.value++}},[mode])
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[applying,setApplying]=useState(false),[operationsBusy,setOperationsBusy]=useState(false),[generationBusy,setGenerationBusy]=useState(false),[sessionFileBusy,setSessionFileBusy]=useState(false),[pairing,setPairing]=useState(false)
 const [existingName,setExistingName]=useState(''),[sourceId,setSourceId]=useState(''),[receiverId,setReceiverId]=useState('')
 const running=bundle.isExecuting||launch.isLoading,launched=mode==='standalone'?!!(bundle.result?.createSignature||bundle.result?.bundleId):!!(launch.receipt||launch.transactionSignature)
 const toolsBusy=generationBusy||sessionFileBusy,busy=applying||operationsBusy||toolsBusy||running||clearing,configurationBlocked=busy||launched||lockedPairIds!==undefined||!ready||library.storageUnavailable||catalog.storageUnavailable
 const hydrateLibrary=library.hydrate,hydratePairs=catalog.hydrate
 useEffect(()=>{hydrateLibrary();hydratePairs()},[hydrateLibrary,hydratePairs])
 useEffect(()=>{
  setReady(false);setSelected([]);setDeployerId('');setRestoredDeployerAddress('');setName('My sniper session');setAllowDefaultDeployer(true)
  try{const saved=readSniperSessionPublicState(localStorage,mode);setSelected(saved.selection);if(saved.profile){setName(saved.profile.name);setRestoredDeployerAddress(saved.profile.deployerAddress);setAllowDefaultDeployer(false)}setReady(true)}
  catch{setError('The saved session cannot be read safely. Your browser data and encrypted wallets are preserved. Restore your saved browser data or session backup before continuing.')}

 },[mode])
 useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false)},[busy,onBusyChange])
 const choose=(ids:string[])=>{try{if(ids.length>16)throw new Error('Choose up to 16 pairs for one launch.');localStorage.setItem(selectionKey(mode),JSON.stringify(ids));setSelected(ids);setError('')}catch(reason){setError(reason instanceof Error?reason.message:'The session selection could not be saved.')}}
 const chosenIds=lockedPairIds??selected,selectedRecords=catalog.pairs.filter(pair=>chosenIds.includes(pair.id)),missingSelection=chosenIds.some(id=>!catalog.pairs.some(pair=>pair.id===id))
 let resolved:ResolvedSniperPair[]=[],resolutionError=''
 try{resolved=resolveSniperPairs(selectedRecords,library.wallets)}catch(reason){resolutionError=reason instanceof Error?reason.message:'Restore the wallets for these pairs.'}
 const allPairAddresses=new Set(catalog.pairs.flatMap(pair=>[pair.sniperAddress,pair.receiverAddress])),deployer=library.wallets.find(wallet=>wallet.id===deployerId),eligibleDeployers=library.wallets.filter(wallet=>!allPairAddresses.has(wallet.publicKey))
 useEffect(()=>{if(!ready||sessionMutation.current)return;try{localStorage.setItem(profileKey(mode),JSON.stringify({version:1,name,deployerAddress:deployer?.publicKey||restoredDeployerAddress}))}catch{setError('The session name and deployer could not be saved. Download your session backup before leaving.')}},[ready,mode,name,deployer?.publicKey,restoredDeployerAddress])
 useEffect(()=>{if(deployerId||!library.hydrated||!ready||!allowDefaultDeployer&&!restoredDeployerAddress&&!lockedPairIds)return;const id=mode==='standalone'?bundle.managedCreatorWalletId:library.activeId;const address=lockedPairIds&&creatorAddress?creatorAddress:restoredDeployerAddress||(mode==='standalone'?bundle.creatorPublicKey:creatorAddress);const value=library.wallets.find(wallet=>!catalog.pairs.some(pair=>pair.sniperAddress===wallet.publicKey||pair.receiverAddress===wallet.publicKey)&&(lockedPairIds&&creatorAddress?wallet.publicKey===creatorAddress:restoredDeployerAddress?wallet.publicKey===restoredDeployerAddress:wallet.id===id||wallet.publicKey===address));if(value)setDeployerId(value.id)},[ready,deployerId,allowDefaultDeployer,restoredDeployerAddress,library.hydrated,library.wallets,library.activeId,bundle.managedCreatorWalletId,bundle.creatorPublicKey,mode,creatorAddress,catalog.pairs,lockedPairIds])
 const lockedIdentity=lockedPairIds?.join(',')
 const readPairs=()=>{const currentCatalog=useSniperPairStore.getState();if(!currentCatalog.hydrated||currentCatalog.storageUnavailable)throw new Error('The pair library is unavailable. Preserve your session backup and review again.');const raw=localStorage.getItem(selectionKey(mode));if(raw!==null&&raw.length>10000)throw new Error('The session selection is invalid.');const ids=lockedPairIds?[...lockedPairIds]:raw===null?selected:JSON.parse(raw);if(!Array.isArray(ids)||ids.length>16||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new Error('The session selection changed. Choose your pairs again.');return useSniperPairStore.getState().pairs.filter(pair=>ids.includes(pair.id))}
 // Live readers invalidate a review when selection, roles, keys or library data change.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const scope=useMemo(()=>{try{return !ready||resolutionError||library.storageUnavailable||catalog.storageUnavailable?null:createSniperPairScope(readPairs,useWalletLibraryStore.getState)}catch{return null}},[ready,resolutionError,catalog.revision,catalog.storageUnavailable,library.revision,library.unlockedIds,library.storageUnavailable,selected,lockedIdentity])
 const matches=(pair:ResolvedSniperPair)=>mode==='standalone'?bundle.bundleWallets.find(row=>row.publicKey===pair.sniperAddress&&row.transferTo===pair.receiverAddress):launch.bundleSettings.wallets.find(row=>row.publicKey===pair.sniperAddress&&row.transferTo===pair.receiverAddress)
 const assigned=resolved.length>0&&resolved.every(pair=>!!matches(pair))&&!!deployer&&(mode==='standalone'?bundle.creatorPublicKey===deployer.publicKey:launch.usePlatformWallet&&platform.getPublicKey()===deployer.publicKey)
 const apply=async()=>{
  if(configurationBlocked)return
  setApplying(true);setError('');setNotice('')
  try{await applySniperPairsToLaunch(mode,resolved,deployerId||undefined);setNotice('Pairs attached. Set each sniper’s buy amount below, back up the session and fund the displayed addresses. Receivers will hold the purchased tokens.')}
  catch(reason){setError(reason instanceof Error?reason.message:'The selected pairs could not be attached.')}
  finally{setApplying(false)}
 }
 const restore=(value:{pairIds:string[];deployerId?:string;name?:string})=>{choose(value.pairIds.slice(0,16));setAllowDefaultDeployer(false);if(value.deployerId)setDeployerId(value.deployerId);if(value.name)setName(value.name);setNotice(value.pairIds.length>16?'All pairs were restored. The first 16 are selected for this session.':'Session wallets are saved. Review your pairs and choose Use these pairs for launch when ready.')}
 const clearSession=async(startNew:boolean)=>{
  if(configurationBlocked||sessionMutation.current)return
  if(startNew&&(catalog.pairs.length>=50||library.wallets.length+2>100)){setError('The wallet or pair library is full. Reuse saved pairs, or manage unused wallets in Wallets before generating more.');return}
  const epoch=viewEpoch.current.value,isCurrent=()=>viewEpoch.current.value===epoch
  sessionMutation.current=true;setClearing(true);setError('');setNotice('')
  try{const removed=await clearSniperSession(mode,selected,{locked:lockedPairIds!==undefined,isCurrent});if(!isCurrent())return;setSelected([]);setName('My sniper session');setAllowDefaultDeployer(false);setDeployerId('');setRestoredDeployerAddress('');setPairing(false);setSourceId('');setReceiverId('');setExistingName('');setGeneratorVersion(value=>startNew?value+1:0);setNotice(startNew?'Fresh session started. Your previous wallets and saved pairs remain in Wallets and Reuse saved pairs.':`Session removed. ${removed.detachedBuyers} matching buyer${removed.detachedBuyers===1?'':'s'} detached. Your encrypted wallets, reusable pairs and transaction history are preserved.`)}
  catch(reason){if(isCurrent())setError(reason instanceof Error?reason.message:'The session could not be removed. Your wallets are preserved.')}
  finally{sessionMutation.current=false;if(isCurrent())setClearing(false)}
 }
 const pairExisting=()=>{try{if(configurationBlocked)return;const source=library.wallets.find(wallet=>wallet.id===sourceId),receiver=library.wallets.find(wallet=>wallet.id===receiverId);if(!source||!receiver)throw new Error('Choose both wallets.');const [pair]=catalog.addPairs([{name:existingName,sniperWalletId:source.id,sniperAddress:source.publicKey,receiverWalletId:receiver.id,receiverAddress:receiver.publicKey}]);choose([...selected,pair.id]);setPairing(false);setSourceId('');setReceiverId('');setExistingName('')}catch(reason){setError(reason instanceof Error?reason.message:'These wallets could not be paired.')}}
 const allocation=(pair:ResolvedSniperPair)=>{
  const row=matches(pair),buy=mode==='standalone'?(row as {buyAmount?:number})?.buyAmount:(row as {buySol?:number})?.buySol
  return <div className={styles.allocation}><label htmlFor={`pair-buy-${mode}-${pair.id}`}>Sniper buy amount <span>SOL</span></label><Input id={`pair-buy-${mode}-${pair.id}`} type="number" min="0" max="1000" step="0.001" inputMode="decimal" value={Number.isFinite(buy)?buy:0} disabled={configurationBlocked||!assigned} onChange={event=>{const amount=event.currentTarget.valueAsNumber;if(mode==='standalone'){const index=useBundlerStore.getState().bundleWallets.findIndex(wallet=>wallet.publicKey===pair.sniperAddress);if(index>=0)useBundlerStore.getState().setBundleWalletBuyAmount(index,amount)}else{const current=useLaunchStore.getState();current.setBundleSettings({...current.bundleSettings,wallets:current.bundleSettings.wallets.map(wallet=>wallet.publicKey===pair.sniperAddress?{...wallet,buySol:amount}:wallet)})}}}/><span className={styles.destination}><ArrowRight size={14}/>New purchase goes to {pair.name} Token Receiver</span></div>
 }
 return <section id={`sniper-pairs-${mode}`} className={styles.workspace} aria-label="Sniper pairs">
 <WorkspaceDisclosure title="Sniper session" description={selectedRecords.length?`${name} · each sniper buys and forwards to its receiver.`:'Generate wallets, reuse saved pairs or import a session.'} meta={busy?'Working…':`${selectedRecords.length} / 16 pairs`}>
 <div className={styles.body}>
  <div className={styles.sessionActions}><div><h2>Sniper pairs</h2><p>One wallet buys. Its receiver holds the tokens and sells.</p></div><div><Button type="button" size="sm" variant="secondary" disabled={configurationBlocked} onClick={()=>void clearSession(true)}><Plus size={14}/>New session</Button><Button type="button" size="sm" variant="ghost" disabled={configurationBlocked||!selected.length&&!deployerId&&name==='My sniper session'} onClick={()=>void clearSession(false)}><Trash2 size={14}/>{clearing?'Removing…':'Remove session'}</Button></div></div>
  <ol className={styles.steps}><li>Generate</li><li>Back up</li><li>Fund wallets</li><li>Launch &amp; sell</li></ol>
  <div className={styles.setup}><label className={styles.sessionName}>Session name<Input value={name} onChange={e=>setName(e.target.value)} maxLength={60} disabled={busy||!ready}/></label><div className={styles.tools}><GenerateSniperSession key={generatorVersion} defaultOpen={generatorVersion>0} maxPairs={Math.max(0,16-selected.length)} includeDeployer={!deployerId} disabled={!ready||applying||operationsBusy||sessionFileBusy||running||launched||clearing||lockedPairIds!==undefined||catalog.storageUnavailable} onCreated={value=>restore({pairIds:value.pairIds,deployerId:value.deployerId})} onBusyChange={setGenerationBusy}/><SniperSessionTools pairs={resolved} deployer={deployer} name={name} disabled={!ready||applying||operationsBusy||generationBusy||running||clearing||catalog.storageUnavailable||!!resolutionError} onRestored={restore} onBusyChange={setSessionFileBusy}/></div><p className={styles.help}>One session backup includes every selected sniper, receiver and the selected LaunchPier deployer. Removing a session keeps its encrypted wallets and reusable pairs.</p></div>
  {catalog.pairs.length>0&&<div className={styles.selection}><div><strong>Reuse saved pairs</strong><button type="button" disabled={configurationBlocked} onClick={()=>choose(catalog.pairs.slice(0,16).map(pair=>pair.id))}>Select first {Math.min(16,catalog.pairs.length)}</button></div><div className={styles.pairChoices}>{catalog.pairs.map(pair=><label key={pair.id}><input type="checkbox" checked={chosenIds.includes(pair.id)} disabled={configurationBlocked||!!lockedPairIds||!selected.includes(pair.id)&&selected.length>=16} onChange={()=>choose(selected.includes(pair.id)?selected.filter(id=>id!==pair.id):[...selected,pair.id])}/>{pair.name}</label>)}</div></div>}
  {ready&&!catalog.pairs.length&&<div className={styles.empty}><Wallet size={26}/><h3>Your first sniper session</h3><p>Generate all the wallet pairs you need together. Download one backup, then fund their addresses yourself. You can reuse the same pairs for your next launch.</p></div>}
  <div className={styles.deployer}><div><label htmlFor={`pair-deployer-${mode}`}>Separate deployer wallet</label><select id={`pair-deployer-${mode}`} value={deployerId} disabled={configurationBlocked} onChange={event=>setDeployerId(event.target.value)}><option value="">Choose your deployer</option>{eligibleDeployers.map(wallet=><option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.publicKey.slice(0,6)}…</option>)}</select><p className={styles.help}>Creates the token. It is separate from the sniper pairs and is excluded from receiver sales.</p>{deployer&&<button type="button" className={styles.address} onClick={()=>void navigator.clipboard.writeText(deployer.publicKey).then(()=>setNotice('Deployer address copied.')).catch(()=>setError('The address could not be copied.'))}><Copy size={13}/>{deployer.publicKey}</button>}</div><CreateManagedWallets title="Create deployer" defaultPrefix="Deployer" maxCount={1} disabled={configurationBlocked} onCreated={wallets=>setDeployerId(wallets[0]?.id||'')}/></div>
  {selectedRecords.length>0&&!launched&&<div className={styles.attach}><Button disabled={configurationBlocked||!resolved.length||!deployerId||!!resolutionError||assigned} onClick={()=>void apply()}>{assigned?<Check size={16}/>:<ArrowRight size={16}/>} {applying?'Attaching pairs…':assigned?'Pairs ready for this launch':'Use these pairs for launch'}</Button><p>{assigned?'Open Relay & receiver sales below to set each sniper’s buy amount. Your selected launch mode controls when they buy.':'This uses sniper wallets as buyers and their receivers as fixed token destinations.'}</p></div>}
  {(error||resolutionError||catalog.error||missingSelection||ready&&resolved.length>0&&!scope)&&<p role="alert" className="notice notice-error">{error||resolutionError||catalog.error||'A saved pair or its wallet storage is unavailable. Choose the pairs for this session again.'}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  {scope&&resolved.length>0&&<SniperPairOperations pairs={resolved} scope={scope} disabled={running||applying||toolsBusy||clearing||catalog.storageUnavailable} onBusyChange={setOperationsBusy} renderPairSettings={allocation}/>}
  <details className={styles.existing}><summary>Pair existing wallets or import individual keys</summary><p className={styles.help}>Use two distinct wallets from your encrypted library. Import individual keys first if they are not saved here.</p><ImportManagedWallets label="Import individual wallets" disabled={configurationBlocked} onImported={()=>setNotice('Wallets saved. Select them as a sniper and receiver below.')}/><button type="button" className="text-link" disabled={configurationBlocked} onClick={()=>setPairing(!pairing)}>Pair existing wallets</button>{pairing&&<div className={styles.existingForm}><label>Pair name<Input value={existingName} onChange={e=>setExistingName(e.target.value)} placeholder="A" maxLength={60}/></label><label>Sniper<select value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">Choose sniper</option>{library.wallets.filter(wallet=>!allPairAddresses.has(wallet.publicKey)&&wallet.id!==deployerId).map(wallet=><option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select></label><label>Token Receiver<select value={receiverId} onChange={e=>setReceiverId(e.target.value)}><option value="">Choose receiver</option>{library.wallets.filter(wallet=>!allPairAddresses.has(wallet.publicKey)&&wallet.id!==deployerId&&wallet.id!==sourceId).map(wallet=><option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select></label><Button disabled={configurationBlocked||!existingName.trim()||!sourceId||!receiverId} onClick={pairExisting}>Save pair</Button></div>}</details>
 </div></WorkspaceDisclosure>
 </section>
}
