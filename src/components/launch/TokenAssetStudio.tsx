'use client'

import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Check, ImagePlus, Palette, Upload, ZoomIn } from 'lucide-react'
import { getArtworkFileError, getCenteredCrop } from './tokenArtwork'
import styles from './TokenAssetStudio.module.css'

interface TokenAssetStudioProps {
  onSelect: (file: Blob, previewUrl: string) => void
  symbol?: string
}

const PALETTES = [
  { name: 'Mint', start: '#c0f7d3', end: '#49bba0', ink: '#10382e' },
  { name: 'Iris', start: '#b6afff', end: '#6d5ce0', ink: '#21164f' },
  { name: 'Sunset', start: '#ffd1aa', end: '#f5756b', ink: '#612d32' },
  { name: 'Ocean', start: '#a3e5ff', end: '#4286dc', ink: '#112f53' },
  { name: 'Electric', start: '#e2fb9c', end: '#a4cb3b', ink: '#273813' },
]

type StudioTab = 'create' | 'crop'

export function TokenAssetStudio({ onSelect, symbol = '' }: TokenAssetStudioProps) {
  const id = useId()
  const [tab, setTab] = useState<StudioTab>('create')
  const [monogram, setMonogram] = useState<string | null>(null)
  const [palette, setPalette] = useState(0)
  const [gradient, setGradient] = useState(true)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [imageName, setImageName] = useState('')
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const objectUrlsRef = useRef(new Set<string>())
  const requestRef = useRef(0)
  const mountedRef = useRef(true)
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])
  const text = Array.from((monogram ?? symbol).trim()).slice(0, 5).join('').toUpperCase() || 'V'

  useEffect(() => {
    const objectUrls = objectUrlsRef.current
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current += 1
      for (const url of objectUrls) URL.revokeObjectURL(url)
      objectUrls.clear()
    }
  }, [])

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return false
    context.clearRect(0, 0, 512, 512)
    if (tab === 'crop') {
      if (!image) return false
      const crop = getCenteredCrop(image.naturalWidth, image.naturalHeight, zoom)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, 512, 512)
      return true
    }

    const colors = PALETTES[palette]
    if (gradient) {
      const fill = context.createLinearGradient(0, 0, 512, 512)
      fill.addColorStop(0, colors.start)
      fill.addColorStop(1, colors.end)
      context.fillStyle = fill
    } else {
      context.fillStyle = colors.start
    }
    context.fillRect(0, 0, 512, 512)
    context.strokeStyle = colors.ink
    context.globalAlpha = 0.12
    context.lineWidth = 1.5
    for (const radius of [164, 204, 244, 284]) {
      context.beginPath()
      context.arc(256, 256, radius, 0, Math.PI * 2)
      context.stroke()
    }
    context.fillStyle = colors.ink
    context.globalAlpha = 0.05
    context.beginPath()
    context.arc(36, 38, 195, 0, Math.PI * 2)
    context.fill()
    context.globalAlpha = 1
    context.fillStyle = colors.ink
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    let fontSize = 188
    context.font = `700 ${fontSize}px system-ui, sans-serif`
    while (context.measureText(text).width > 408 && fontSize > 48) {
      fontSize -= 4
      context.font = `700 ${fontSize}px system-ui, sans-serif`
    }
    context.fillText(text, 256, 270)
    return true
  }, [tab, image, zoom, palette, gradient, text])

  useEffect(() => { drawPreview() }, [drawPreview])

  const selectTab = (next: StudioTab) => {
    setTab(next)
    setError(null)
    setNotice('')
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = index === 0 ? 1 : 0
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 1
    else return
    event.preventDefault()
    selectTab(next === 0 ? 'create' : 'crop')
    tabsRef.current[next]?.focus()
  }

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const request = ++requestRef.current
    setError(null)
    setNotice('')
    const validationError = getArtworkFileError(file)
    if (validationError) {
      setLoading(false)
      setError(validationError)
      return
    }
    setLoading(true)
    const sourceUrl = URL.createObjectURL(file)
    objectUrlsRef.current.add(sourceUrl)
    try {
      const decoded = new Image()
      decoded.src = sourceUrl
      await decoded.decode()
      if (request !== requestRef.current || !mountedRef.current) {
        return
      }
      if (!decoded.naturalWidth || !decoded.naturalHeight || decoded.naturalWidth * decoded.naturalHeight > 40_000_000) {
        throw new Error('Choose an image smaller than 40 megapixels.')
      }
      // Freeze the first rendered frame so animated uploads cannot change between preview and export.
      const snapshot = document.createElement('canvas')
      const scale = Math.min(1, 4096 / Math.max(decoded.naturalWidth, decoded.naturalHeight))
      snapshot.width = Math.max(1, Math.round(decoded.naturalWidth * scale))
      snapshot.height = Math.max(1, Math.round(decoded.naturalHeight * scale))
      const snapshotContext = snapshot.getContext('2d')
      if (!snapshotContext) throw new Error('Image editing is unavailable in this browser.')
      snapshotContext.drawImage(decoded, 0, 0, snapshot.width, snapshot.height)
      const frozen = new Image()
      frozen.src = snapshot.toDataURL('image/png')
      await frozen.decode()
      if (request !== requestRef.current || !mountedRef.current) {
        return
      }
      setImage(frozen)
      setImageName(file.name)
      setZoom(1)
    } catch (reason) {
      if (request === requestRef.current && mountedRef.current) {
        setError(reason instanceof Error && reason.message.startsWith('Choose')
          ? reason.message
          : 'This image could not be opened. Try another PNG, JPEG, WebP or GIF.')
      }
    } finally {
      URL.revokeObjectURL(sourceUrl)
      objectUrlsRef.current.delete(sourceUrl)
      if (request === requestRef.current && mountedRef.current) setLoading(false)
    }
  }

  const useArtwork = async () => {
    setError(null)
    setNotice('')
    if (!drawPreview() || !canvasRef.current) {
      setError(tab === 'crop' ? 'Choose an image to crop first.' : 'Artwork could not be created in this browser.')
      return
    }
    setExporting(true)
    try {
      const canvas = canvasRef.current
      const previewUrl = canvas.toDataURL('image/png')
      const file = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Artwork export failed. Please try again.')), 'image/png')
      })
      if (!mountedRef.current) return
      onSelect(file, previewUrl)
      setNotice('Artwork applied to your token.')
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : 'Artwork export failed. Please try again.')
    } finally {
      if (mountedRef.current) setExporting(false)
    }
  }

  return (
    <section className={styles.studio} aria-labelledby={`${id}-title`}>
      <div className={styles.header}>
        <span className={styles.icon}><Palette size={17} aria-hidden="true" /></span>
        <div><h3 id={`${id}-title`}>Artwork studio</h3><p>A small canvas. A big first impression.</p></div>
        <span className={styles.localBadge}>Local</span>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Artwork source">
        {(['create', 'crop'] as const).map((value, index) => (
          <button key={value} ref={element => { tabsRef.current[index] = element }} type="button" role="tab"
            id={`${id}-${value}-tab`} aria-selected={tab === value} aria-controls={`${id}-panel`}
            tabIndex={tab === value ? 0 : -1} onClick={() => selectTab(value)} onKeyDown={event => onTabKeyDown(event, index)}>
            {value === 'create' ? <Palette size={14} aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
            {value === 'create' ? 'Create artwork' : 'Crop image'}
          </button>
        ))}
      </div>
      <div className={styles.editor} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}-tab`}>
        <div className={styles.previewArea}>
          <div className={styles.preview}>
            <canvas ref={canvasRef} width={512} height={512} role="img" aria-label={tab === 'create' ? `${text} token artwork preview` : 'Centered square crop preview'} />
            {tab === 'crop' && !image && <div className={styles.emptyPreview}><ImagePlus size={28} aria-hidden="true" /><span>Your image here</span></div>}
          </div>
          <span className={styles.dimensions}>512 × 512 · PNG</span>
        </div>
        <div className={styles.controls}>
          {tab === 'create' ? <>
            <div className={styles.field}>
              <label htmlFor={`${id}-monogram`}>Monogram</label>
              <input id={`${id}-monogram`} value={monogram ?? symbol.slice(0, 5)} maxLength={5} placeholder="V"
                onChange={event => { setMonogram(event.target.value); setNotice('') }} autoComplete="off" />
              <p>Keep it short. Up to 5 characters.</p>
            </div>
            <fieldset className={styles.field}><legend>Color palette</legend>
              <div className={styles.swatches}>
                {PALETTES.map((colors, index) => <button type="button" key={colors.name} aria-label={`${colors.name} palette`}
                  aria-pressed={palette === index} title={colors.name} onClick={() => { setPalette(index); setNotice('') }}
                  style={{ background: `linear-gradient(135deg, ${colors.start}, ${colors.end})` }}>
                  {palette === index && <Check size={16} style={{ color: colors.ink }} aria-hidden="true" />}
                </button>)}
              </div>
            </fieldset>
            <label className={styles.checkbox}><input type="checkbox" checked={gradient} onChange={event => { setGradient(event.target.checked); setNotice('') }} />Gradient background</label>
          </> : <>
            <label className={styles.upload} htmlFor={`${id}-upload`}>
              <Upload size={19} aria-hidden="true" /><strong>{loading ? 'Opening image…' : image ? 'Replace image' : 'Choose an image'}</strong>
              <span>PNG, JPEG, WebP or GIF · max 5 MB</span>
              <input id={`${id}-upload`} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={upload} disabled={loading || exporting} />
            </label>
            {image && <div className={styles.field}>
              <div className={styles.zoomLabel}><label htmlFor={`${id}-zoom`}><ZoomIn size={14} aria-hidden="true" />Zoom</label><span>{zoom.toFixed(1)}×</span></div>
              <input id={`${id}-zoom`} type="range" min={1} max={3} step={0.05} value={zoom} disabled={loading || exporting}
                onChange={event => { setZoom(Number(event.target.value)); setNotice('') }} />
              <p className={styles.filename} title={imageName}>{imageName}</p>
            </div>}
            <p className={styles.hint}>Images crop to the center. Animated images become a still PNG.</p>
          </>}
        </div>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.footer}>
        <p role="status">{notice || 'Created in your browser. Applied when you choose.'}</p>
        <button type="button" className={styles.apply} onClick={useArtwork} disabled={exporting || loading || (tab === 'crop' && !image)}>
          {notice ? <Check size={15} aria-hidden="true" /> : null}{exporting ? 'Exporting…' : 'Use artwork'}
        </button>
      </div>
    </section>
  )
}
