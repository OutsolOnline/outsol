'use client'
import {Eye} from 'lucide-react'
import {useEffect,useState} from 'react'
import {useLaunchStore} from '@/stores/launchStore'
import styles from './LaunchBuilder.module.css'
export function TokenPreview(){
 const {metadata,imagePreview}=useLaunchStore()
 const [expanded,setExpanded]=useState(true)
 useEffect(()=>{const media=matchMedia('(max-width:720px)');const change=()=>setExpanded(!media.matches);change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[])
 return <details className={styles.previewDisclosure} open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}><summary>Token preview<Eye size={15}/></summary><aside className={styles.preview} aria-label="Live token preview"><div className={styles.previewLabel}><span>Live preview</span><span className={styles.previewStatus}>Design</span></div><div className={styles.previewArt}>{imagePreview?<img src={imagePreview} alt="Your token artwork"/>:<div className={styles.previewPlaceholder}><img src="/favicon.svg" alt=""/><span>Your artwork appears here</span></div>}</div><h2 className={styles.previewName}>{metadata?.name||'Your token name'}</h2><p className={styles.previewSymbol}>${metadata?.symbol||'TOKEN'}</p>{metadata?.description&&<p className={styles.previewStory}>{metadata.description}</p>}<div className={styles.previewBadges}><span>Pump.fun</span><span>Not launched</span></div><p className={styles.previewNote}>Public identity preview. Metadata and costs are reviewed before you sign.</p></aside></details>
}
