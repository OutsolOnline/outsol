'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Loader2, MessageSquareText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createLaunchAnnouncement, createXAnnouncementIntent, MAX_ANNOUNCEMENT_LENGTH, type LaunchAnnouncementDetails } from '@/lib/launchAnnouncement'
import styles from './LaunchAnnouncement.module.css'

/** Render only after the parent has verified a confirmed receipt for this mint. */
export function LaunchAnnouncement({ mint, name, symbol }: LaunchAnnouncementDetails) {
  const initial = useMemo(() => {
    try { return { text: createLaunchAnnouncement({ mint, name, symbol }), error: '' } }
    catch { return { text: '', error: 'This launch announcement is unavailable because its mint could not be verified.' } }
  }, [mint, name, symbol])
  const [draft, setDraft] = useState(() => ({ mint, text: initial.text }))
  const [copyState, setCopyState] = useState({ mint, notice: '', copying: false })
  const notice = copyState.mint === mint ? copyState.notice : '', copying = copyState.mint === mint && copyState.copying
  const alive = useRef(true), copyEpoch = useRef(0)
  const text = draft.mint === mint ? draft.text : initial.text
  const prepared = useMemo(() => {
    try { return { href: createXAnnouncementIntent(mint, text), error: '' } }
    catch (failure) { return { href: '', error: text.trim() ? failure instanceof Error ? failure.message : 'Review this announcement before opening X.' : '' } }
  }, [mint, text])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const update = (value: string) => { copyEpoch.current++; setCopyState({ mint, notice: '', copying: false }); setDraft({ mint, text: value }) }
  const copy = async () => {
    if (!prepared.href || copying) return
    const epoch = ++copyEpoch.current; setCopyState({ mint, notice: '', copying: true })
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      if (alive.current && copyEpoch.current === epoch) setCopyState({ mint, notice: 'Announcement copied.', copying: false })
    } catch { if (alive.current && copyEpoch.current === epoch) setCopyState({ mint, notice: 'Copy is unavailable here. Select the announcement text and copy it yourself.', copying: false }) }
  }

  return <section className={styles.announcement} aria-labelledby="launch-announcement-title">
    <div className={styles.heading}><span className={styles.icon}><MessageSquareText size={19} /></span><div><h2 id="launch-announcement-title">Share your launch on X</h2><p>Give your launch an announcement in your own words.</p></div><span className={styles.optional}>Optional</span></div>
    {initial.error ? <p role="alert" className={styles.error}>{initial.error}</p> : <>
      <div className={styles.labelRow}><label htmlFor="launch-announcement-text">Your announcement</label><span id="launch-announcement-count">{text.length}/{MAX_ANNOUNCEMENT_LENGTH}</span></div>
      <Textarea id="launch-announcement-text" value={text} maxLength={MAX_ANNOUNCEMENT_LENGTH} rows={6} onChange={event => update(event.target.value)} aria-describedby="launch-announcement-count launch-announcement-help" aria-invalid={Boolean(prepared.error)} className={styles.textarea} />
      {prepared.error && <p role="alert" className={styles.error}>{prepared.error}</p>}
      <div className={styles.actions}><Button type="button" variant="secondary" disabled={!prepared.href || copying} onClick={() => void copy()}>{copying ? <Loader2 size={15} className="animate-spin" /> : notice === 'Announcement copied.' ? <Check size={15} /> : <Copy size={15} />}{copying ? 'Copying…' : 'Copy text'}</Button>{prepared.href ? <a className="primary-action" href={prepared.href} target="_blank" rel="noreferrer noopener" aria-describedby="launch-announcement-help">Review & post on X<ExternalLink size={15} /></a> : <Button type="button" disabled>Review & post on X<ExternalLink size={15} /></Button>}</div>
      <p id="launch-announcement-help" className={styles.help}>Opens X’s composer in another tab. Review the announcement and choose Post there to publish it. Signing in to X may be required.</p>
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
    </>}
  </section>
}
