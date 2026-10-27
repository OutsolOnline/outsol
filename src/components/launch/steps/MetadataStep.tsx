'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ImagePlus, Images, Link2, Paintbrush, Type, X } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useLaunchStore } from '@/stores/launchStore'
import { validateTokenDetails } from '@/lib/launchConfig'
import type { TokenMetadata } from '@/lib/pumpfun/types'
import { TokenAssetStudio } from '../TokenAssetStudio'
import { ArtworkLibrary } from '../ArtworkLibrary'
import styles from '../LaunchBuilder.module.css'

export function MetadataStep() {
  const store = useLaunchStore()
  const form:TokenMetadata=store.metadata||{name:'',symbol:'',description:'',website:'',twitter:'',telegram:''}
  const uri=store.metadataUri||'',setUri=(value:string)=>store.setMetadataUri(value)
  const [errors, setErrors] = useState<Record<string,string>>({})
  const fileInput = useRef<HTMLInputElement>(null), reader = useRef<FileReader | null>(null)
  useEffect(() => () => { reader.current?.abort() }, [])
  const update = (field: keyof TokenMetadata, value: string) => {
    const next = { ...form, [field]: value }; store.setMetadata(next)
    setErrors(previous => ({ ...previous, [field]: '' }))
  }
  const applyImage = (file: Blob, preview: string) => {
    if(!store.metadata)store.setMetadata(form)
    store.setImageFile(file); store.setImagePreview(preview); store.setError(null)
    setUri(''); store.setMetadataUri('')
    setErrors(previous => ({ ...previous, image: '' }))
  }
  const image = (file?: File) => {
    if (!file) return
    if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) { setErrors(previous => ({ ...previous, image: 'Choose a PNG, JPEG, WebP or GIF up to 5 MB.' })); return }
    reader.current?.abort()
    const next = new FileReader(); reader.current = next
    next.onload = () => { if (reader.current === next && typeof next.result === 'string') applyImage(file, next.result) }
    next.onerror = () => setErrors(previous => ({ ...previous, image: 'This image could not be read. Choose another file.' }))
    next.readAsDataURL(file)
  }
  const next = () => {
    const nextErrors = validateTokenDetails(form) as Record<string,string>
    if (uri && (!/^(https:\/\/|ipfs:\/\/)/.test(uri.trim()) || new TextEncoder().encode(uri.trim()).length > 200)) nextErrors.uri = 'Use an HTTPS or IPFS metadata JSON URI up to 200 bytes.'
    if (!uri.trim() && !store.imageFile) nextErrors.image = 'Choose token artwork, or provide an existing public metadata URI below.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    store.setMetadata({ ...form, name: form.name.trim(), symbol: form.symbol.trim(), website: form.website?.trim(), twitter: form.twitter?.trim(), telegram: form.telegram?.trim() })
    store.setMetadataUri(uri.trim()); store.nextStep()
  }
  const nameBytes = new TextEncoder().encode(form.name).length
  return <div className={styles.detailsForm}>
    <div className={styles.sectionHeading}><span className={styles.sectionIcon}><Type size={18} /></span><div><h2>Design your token</h2><p>Start with the identity people will see on Pump.fun.</p></div></div>
    <div className={styles.uploadArea}><button type="button" onClick={() => fileInput.current?.click()} className={styles.uploadImage} aria-label="Upload token artwork">{store.imagePreview ? <img src={store.imagePreview} alt="Token artwork" /> : <ImagePlus size={25} strokeWidth={1.5} />}</button><div className={styles.uploadCopy}><Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>{store.imagePreview ? 'Change artwork' : 'Upload artwork'}</Button>{store.imagePreview&&<button type="button" className="text-link ml-3" onClick={()=>{reader.current?.abort();store.setImageFile(null);store.setImagePreview(null);store.setMetadataUri('');setUri('')}}><X size={13}/>Remove</button>}<p>PNG, JPEG, WebP or GIF<br />Square images work best · up to 5 MB</p></div><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" ref={fileInput} onChange={e => { image(e.target.files?.[0]); e.target.value = '' }} /></div>
    {errors.image && <p className="notice notice-error mb-5" role="alert">{errors.image}</p>}
    <div className={styles.fieldRow}><div><div className={styles.labelRow}><label htmlFor="token-name">Token name</label><span className={nameBytes > 32 ? 'text-red-300' : ''}>{nameBytes}/32 bytes</span></div><Input id="token-name" placeholder="Your token name" value={form.name} aria-invalid={!!errors.name} onChange={e => update('name',e.target.value)} autoComplete="off" />{errors.name && <p role="alert" className="field-help !text-red-300">{errors.name}</p>}</div><div><div className={styles.labelRow}><label htmlFor="token-symbol">Symbol</label><span>{form.symbol.length}/10</span></div><Input id="token-symbol" placeholder="TOKEN" value={form.symbol} maxLength={10} aria-invalid={!!errors.symbol} onChange={e => update('symbol',e.target.value.toUpperCase())} autoComplete="off" />{errors.symbol && <p role="alert" className="field-help !text-red-300">{errors.symbol}</p>}</div></div>
    <div className={styles.inputSection}><div className={styles.labelRow}><label htmlFor="token-description">Description <span>· optional</span></label><span>{form.description.length}/1,000</span></div><Textarea id="token-description" placeholder="Tell people what you’re creating." value={form.description} maxLength={1000} aria-invalid={!!errors.description} onChange={e => update('description',e.target.value)} />{errors.description && <p role="alert" className="field-help !text-red-300">{errors.description}</p>}</div>
    <div className="mt-6"><details className={styles.advancedSection}><summary><span><Paintbrush size={15} />Create or crop artwork</span></summary><div className={styles.advancedContent}><TokenAssetStudio symbol={form.symbol} onSelect={applyImage} /></div></details>
    <details className={styles.advancedSection}><summary><span><Images size={15} />Saved artwork</span></summary><div className={styles.advancedContent}><ArtworkLibrary onSelect={applyImage} /></div></details>
    <details className={styles.advancedSection}><summary><span><Link2 size={15} />Social links & existing metadata</span></summary><div className={`${styles.advancedContent} space-y-5`}>{([{key:'website',label:'Website',placeholder:'https://yourproject.com'},{key:'twitter',label:'X / Twitter',placeholder:'https://x.com/yourproject'},{key:'telegram',label:'Telegram',placeholder:'https://t.me/yourproject'}] as const).map(field => <div key={field.key}><label htmlFor={field.key} className="field-label">{field.label}</label><Input id={field.key} type="url" placeholder={field.placeholder} value={form[field.key]} aria-invalid={!!errors[field.key]} onChange={e => update(field.key,e.target.value)} />{errors[field.key] && <p role="alert" className="field-help !text-red-300">{errors[field.key]}</p>}</div>)}<div><label className="field-label" htmlFor="metadata-uri">Existing metadata URI <span className="text-muted">· optional</span></label><Input id="metadata-uri" placeholder="https://…/metadata.json or ipfs://…" value={uri} aria-invalid={!!errors.uri} onChange={e => { setUri(e.target.value); store.setMetadataUri(e.target.value) }} /><p className="field-help">Use your own public JSON instead of uploading the image and details above. Review that JSON before signing.</p>{errors.uri && <p role="alert" className="field-help !text-red-300">{errors.uri}</p>}</div></div></details></div>
    <div className={styles.formActions}><Link href="/launches" className="text-link">Back to launches</Link><Button onClick={next}>Continue<ArrowRight size={15} /></Button></div>
    </div>
}
