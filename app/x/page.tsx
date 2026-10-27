'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, ChevronRight, ExternalLink, FileText, Image as ImageIcon, Link2, Loader2, LockKeyhole, LogOut, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { postToWebCapture, type XPost } from '@/lib/xPosts'
import { canonicalXPostUrl, readXPost, readXSession, safeXConnectionUrl, xWorkspaceRequest, XWorkspaceError, type XSession } from '@/lib/xWorkspace'
import styles from './page.module.css'

type Busy = 'connect' | 'disconnect' | 'import' | 'posts'
const captureLink = (capture: ReturnType<typeof postToWebCapture>) => '/extension#import=' + encodeURIComponent(JSON.stringify(capture))

function postDate(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function XLaunchPage() {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [post, setPost] = useState<XPost | null>(null)
  const [session, setSession] = useState<XSession | null>(null)
  const [posts, setPosts] = useState<XPost[] | null>(null)
  const [fetchedAt, setFetchedAt] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showImages, setShowImages] = useState(false)
  const [imageErrors, setImageErrors] = useState<number[]>([])
  const [sessionExpired, setSessionExpired] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const alive = useRef(false), epoch = useRef(0), working = useRef<Busy | null>(null), controller = useRef<AbortController | null>(null)
  const sessionController = useRef<AbortController | null>(null), sessionEpoch = useRef(0)
  const previewHeading = useRef<HTMLHeadingElement>(null), input = useRef<HTMLInputElement>(null)

  const current = (id: number) => alive.current && epoch.current === id
  const perform = async (kind: Busy, task: (signal: AbortSignal, id: number) => Promise<void>) => {
    if (working.current) return
    const id = ++epoch.current, request = new AbortController()
    controller.current = request; working.current = kind; setBusy(kind); setError('')
    try { await task(request.signal, id) }
    catch (failure) {
      if (!current(id) || failure instanceof Error && failure.name === 'AbortError') return
      if (failure instanceof XWorkspaceError && failure.status === 401) {
        setSession(value => value ? { available: value.available, connected: false } : null); setSessionExpired(true); setPosts(null)
      }
      setError(failure instanceof Error ? failure.message : 'This request could not be completed. Try again.')
    } finally { if (current(id)) { working.current = null; controller.current = null; setBusy(null) } }
  }

  const checkSession = async () => {
    sessionController.current?.abort()
    const request = new AbortController(), id = ++sessionEpoch.current
    sessionController.current = request; setCheckingSession(true)
    try {
      const result = readXSession(await xWorkspaceRequest('/api/x/session', { signal: request.signal }))
      if (alive.current && sessionEpoch.current === id) { setSession(result); setSessionExpired(false) }
    } catch (failure) {
      if (alive.current && sessionEpoch.current === id && !(failure instanceof Error && failure.name === 'AbortError')) setSession(null)
    } finally { if (alive.current && sessionEpoch.current === id) { sessionController.current = null; setCheckingSession(false) } }
  }

  useEffect(() => {
    alive.current = true
    const query = new URL(window.location.href), status = query.searchParams.get('connection')
    if (status) {
      if (status === 'connected') setNotice('X authorization returned. Check your account status below, then load your posts when you are ready.')
      else if (status === 'cancelled') setNotice('X connection was canceled. You can still use a public post link.')
      else if (status === 'error') setNotice('X connection did not finish. Try connecting again, or use a public post link.')
      query.searchParams.delete('connection')
      window.history.replaceState(window.history.state, '', query.pathname + query.search + query.hash)
    }
    void checkSession()
    return () => { alive.current = false; working.current = null; controller.current?.abort(); sessionController.current?.abort() }
    // A session check runs on entry only. Loading posts always follows a click.
  }, [])

  const selectPost = (value: XPost) => {
    setPost(value); setShowImages(false); setImageErrors([])
    requestAnimationFrame(() => previewHeading.current?.focus())
  }
  const importPost = () => {
    let source: string
    try { source = canonicalXPostUrl(url) } catch (failure) { setError((failure as Error).message); input.current?.focus(); return }
    void perform('import', async (signal, id) => {
      const result = await xWorkspaceRequest<{ post: unknown }>('/api/x/post', { method: 'POST', body: { url: source }, signal })
      const imported = readXPost(result.post)
      if (current(id)) { selectPost(imported); setUrl(source); setNotice('') }
    })
  }
  const connect = () => void perform('connect', async (signal, id) => {
    const result = await xWorkspaceRequest<{ authorizeUrl?: string; continueUrl?: string }>('/api/x/connect', { method: 'POST', body: {}, signal })
    const destination = safeXConnectionUrl(result)
    if (current(id)) window.location.assign(destination)
  })
  const disconnect = () => void perform('disconnect', async (signal, id) => {
    const result = await xWorkspaceRequest<{ disconnected?: boolean; providerRevoked?: boolean }>('/api/x/disconnect', { method: 'POST', body: {}, signal })
    if (result.disconnected !== true) throw new XWorkspaceError('X could not be disconnected. Try again.')
    if (current(id)) {
      setSession(value => ({ available: value?.available ?? true, connected: false })); setPosts(null); setFetchedAt(''); setSessionExpired(false)
      setNotice(result.providerRevoked ? 'X disconnected and account access revoked.' : 'X disconnected from OutSol. To remove access at X too, open your X connected-app settings.')
    }
  })
  const loadPosts = () => void perform('posts', async (signal, id) => {
    const result = await xWorkspaceRequest<{ posts: unknown[]; fetchedAt: string }>('/api/x/posts', { signal })
    if (!Array.isArray(result.posts) || result.posts.length > 5) throw new XWorkspaceError('Your posts could not be read. Try again or use a public post link.')
    const latest = result.posts.map(readXPost)
    if (current(id)) { setPosts(latest); setFetchedAt(typeof result.fetchedAt === 'string' ? result.fetchedAt : '') }
  })
  const manual = () => {
    try { const sourceUrl = canonicalXPostUrl(url); router.push(captureLink({ version: 1, kind: 'page', name: '', symbol: '', description: '', sourceUrl })) }
    catch (failure) { setError((failure as Error).message); input.current?.focus() }
  }
  const usePost = () => {
    if (!post || busy) return
    try { router.push(captureLink(postToWebCapture(post))) }
    catch { setError('This post could not be prepared. Try another public post or enter the details manually.') }
  }
  const cancel = () => { epoch.current++; controller.current?.abort(); controller.current = null; working.current = null; setBusy(null); setNotice('Request canceled. Your current source is preserved.') }
  const date = postDate(post?.createdAt)

  return <div className="min-h-screen flex flex-col"><Header />
    <main id="workspace-content" tabIndex={-1} className={`workspace-main flex-1 ${styles.main}`}>
      <header className={styles.heading}>
        <div><span className="eyebrow">LAUNCH FROM X</span><h1>A post. A starting point.</h1><p>Bring a public post into your next Pump.fun token.<br className={styles.desktopBreak} /> Review the idea, make it yours, then choose when to launch.</p></div>
        <div className={styles.destination}><span className={styles.pumpMark} aria-hidden="true" /><div><span>Pump.fun</span><small>Solana launch workspace</small></div></div>
      </header>

      <div className={styles.workflow} role="list" aria-label="Launch from X steps"><div role="listitem" className={styles.currentStep}><b>01</b><span>Choose a post</span></div><ChevronRight size={14} aria-hidden="true" /><div role="listitem"><b>02</b><span>Review your draft</span></div><ChevronRight size={14} aria-hidden="true" /><div role="listitem"><b>03</b><span>Choose a mint & sign</span></div></div>

      {error && <div className={`notice notice-error ${styles.feedback}`} role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className={`notice ${styles.feedback}`} role="status"><span>{notice}{notice.includes('connected-app settings') && <> <a href="https://x.com/settings/connected_apps" target="_blank" rel="noreferrer" className="underline">Manage X access<ExternalLink size={12} className="inline ml-1" /></a></>}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={16} /></button></div>}

      <div className={styles.workspace}>
        <div className={styles.sourceColumn}>
          <section className={`workspace-card ${styles.importCard}`} aria-labelledby="import-title" aria-busy={busy === 'import'}>
            <div className={styles.sectionHeading}><span className={styles.sectionIcon}><Link2 size={19} /></span><div><h2 id="import-title">Start with a public post</h2><p>No X connection needed.</p></div><span className={styles.label}>PUBLIC LINK</span></div>
            <form onSubmit={event => { event.preventDefault(); importPost() }}>
              <label className="field-label" htmlFor="x-post-url">X post link</label>
              <div className={styles.urlForm}><Input ref={input} id="x-post-url" type="url" maxLength={2000} autoComplete="off" spellCheck={false} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://x.com/account/status/…" required disabled={Boolean(busy)} aria-describedby="x-post-help" /><Button type="submit" disabled={Boolean(busy)}>{busy === 'import' ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}{busy === 'import' ? 'Importing…' : 'Import post'}</Button></div>
              <p id="x-post-help" className="field-help mt-3">Public post text is fetched only when you import. Deleted, private or restricted posts may be unavailable.</p>
            </form>
            <div className={styles.manualRow}><span>Prefer to enter the details yourself?</span><button type="button" disabled={Boolean(busy)} onClick={manual}>Prepare manually<ArrowRight size={13} /></button></div>
          </section>

          <section className={styles.preview} aria-labelledby="post-preview-title" aria-busy={busy === 'import'}>
            <div className={styles.previewTop}><span className="eyebrow">SOURCE PREVIEW</span><span>{post ? 'Ready for your review' : busy === 'import' ? 'Fetching public post' : 'Waiting for a post'}</span></div>
            {busy === 'import' ? <div className={styles.loadingPreview} role="status"><Loader2 className="animate-spin" size={25} /><h2>Bringing in your source…</h2><p>The current preview stays available when this request finishes.</p><Button variant="ghost" size="sm" onClick={cancel}>Cancel import</Button></div> : post ? <>
              <div className={styles.postAuthor}><span className={styles.avatar} aria-hidden="true">{post.author.name.slice(0, 1) || '@'}</span><div><h2 id="post-preview-title" ref={previewHeading} tabIndex={-1}>{post.author.name}</h2><p>@{post.author.username}{date && <> <span>·</span> <time dateTime={post.createdAt}>{date}</time></>}</p></div><a href={post.url} target="_blank" rel="noreferrer" aria-label="Open original post on X"><ExternalLink size={16} /></a></div>
              <div className={styles.postText}>{post.text || <span className="text-muted">This post has no text. Add a name and description when you review the draft.</span>}</div>
              {post.images.length > 0 && <div className={styles.mediaSection}>{showImages ? <div className={styles.mediaGrid}>{post.images.map((image, index) => <div className={styles.mediaImage} key={image.url}>{imageErrors.includes(index) ? <p>Image preview unavailable. You can choose artwork in your draft.</p> : <img src={image.url} alt={image.alt || `Post image ${index + 1}`} referrerPolicy="no-referrer" onError={() => setImageErrors(value => [...value, index])} />}</div>)}</div> : <div className={styles.mediaPrompt}><ImageIcon size={22} /><div><strong>{post.images.length} image{post.images.length === 1 ? '' : 's'} referenced</strong><p>Previewing requests images from X. Artwork import is a separate choice in your draft.</p></div><Button variant="secondary" size="sm" onClick={() => setShowImages(true)}>Preview images</Button></div>}</div>}
              <div className={styles.postFoot}><span><ShieldCheck size={14} />Source is a reference, not an endorsement.</span><span>{post.source === 'oembed' ? 'Public post import' : 'X account import'}</span></div>
              <div className={styles.draftAction}><div><h3>Give the idea your own direction.</h3><p>Edit the name, add a symbol and choose artwork in a separate draft.</p></div><Button onClick={usePost} disabled={Boolean(busy)}>Use post in draft<ArrowRight size={16} /></Button></div>
            </> : <div className={styles.emptyPreview}><span className={styles.emptyIcon}><FileText size={28} strokeWidth={1.3} /><span><Link2 size={13} /></span></span><h2 id="post-preview-title">Your source will appear here.</h2><p>Import a public link or choose one of your posts.<br />You’ll see the details before using them in a draft.</p><span className={styles.emptyHint}>POST → YOUR IDEA → FRESH TOKEN</span></div>}
          </section>

          {session?.connected && posts !== null && <section className={`workspace-card ${styles.postsCard}`} aria-labelledby="my-posts-title"><div className={styles.postsHeading}><div><h2 id="my-posts-title">Your latest posts</h2><p>Choose a source to preview.</p></div><span>{posts.length}/5</span></div>{posts.length ? <ul className={styles.postList}>{posts.map(item => <li key={item.id}><button type="button" disabled={Boolean(busy)} className={post?.id === item.id ? styles.selectedPost : ''} onClick={() => selectPost(item)}><div><span>{postDate(item.createdAt) || `@${item.author.username}`}</span><p>{item.text || 'Image post · review the source and add your own details.'}</p></div>{post?.id === item.id ? <Check size={17} /> : <ArrowRight size={17} />}</button></li>)}</ul> : <div className={styles.noPosts}><FileText size={22} /><p>No eligible public posts were returned. Try a public post link above.</p></div>}{postDate(fetchedAt) && <p className="field-help mt-4">Fetched {postDate(fetchedAt)}. This list updates only when you load it again.</p>}</section>}

          <p className={styles.sourceNote}>Use content you have permission to reuse. Imported text and image references are suggestions; review every detail before creating a token.</p>
        </div>

        <aside className={styles.sideColumn}>
          <section className={`workspace-card ${styles.accountCard}`} aria-labelledby="x-account-title" aria-busy={checkingSession || ['connect', 'disconnect', 'posts'].includes(busy || '')}>
            <div className={styles.accountHeading}><span className={styles.xMark} aria-hidden="true">𝕏</span><span className={session?.connected ? styles.connectedBadge : styles.optionalBadge}>{session?.connected ? <><span />Connected</> : 'Optional'}</span></div>
            <h2 id="x-account-title">Your X account</h2>
            {checkingSession ? <div className={styles.sessionLoading} role="status"><Loader2 size={16} className="animate-spin" />Checking connection…</div> : session?.connected && session.user ? <>
              <div className={styles.accountUser}><span className={styles.avatar}><UserRound size={18} /></span><div><strong>{session.user.name}</strong><span>@{session.user.username}</span></div></div>
              {session.user.protected ? <p className={styles.accountCopy}><LockKeyhole size={14} className="inline mr-1" />This account is protected. Its posts cannot be used for public token drafts. Import an eligible public post instead.</p> : <><p className={styles.accountCopy}>Choose from your latest five public posts. Posts are loaded only when you ask.</p><Button variant="secondary" className="w-full mt-5" disabled={Boolean(busy)} onClick={loadPosts}>{busy === 'posts' ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={15} />}{busy === 'posts' ? 'Loading posts…' : posts === null ? 'Load my latest posts' : 'Refresh latest posts'}</Button></>}
              <Button variant="ghost" size="sm" className="w-full mt-3" disabled={Boolean(busy)} onClick={disconnect}>{busy === 'disconnect' ? <Loader2 className="animate-spin" size={14} /> : <LogOut size={14} />}{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect X'}</Button>
            </> : session?.available ? <><p className={styles.accountCopy}>{sessionExpired ? 'Your connection has expired. Reconnect to choose from your own posts.' : 'Connect to choose from your own latest posts, without copying a link.'}</p><Button variant="secondary" className="w-full mt-5" disabled={Boolean(busy)} onClick={connect}>{busy === 'connect' && <Loader2 className="animate-spin" size={16} />}{busy === 'connect' ? 'Opening X…' : sessionExpired ? 'Reconnect X' : 'Connect X'}{busy !== 'connect' && <ArrowRight size={15} />}</Button></> : session ? <><p className={styles.setupBadge}><span />Setup pending</p><p className={styles.accountCopy}>Account connection is not enabled yet. You can import a public post now or prepare its details manually.</p><button className={styles.retryConnection} type="button" disabled={Boolean(busy)} onClick={() => void checkSession()}><RefreshCw size={13} />Check availability</button></> : <><p className={styles.accountCopy}>Your connection could not be checked. Public post import is still available.</p><Button variant="secondary" className="w-full mt-5" disabled={Boolean(busy)} onClick={() => void checkSession()}><RefreshCw size={14} />Retry connection check</Button></>}
            <div className={styles.accessNote}><ShieldCheck size={15} /><p>Read-only account access. OutSol cannot publish posts. Disconnect whenever you choose.</p></div>
          </section>

          <section className={`workspace-card ${styles.nextCard}`} aria-labelledby="next-title"><span className="eyebrow">ALWAYS IN YOUR CONTROL</span><h2 id="next-title">An idea becomes a draft.</h2><ol><li><span>1</span><div><h3>Review the source</h3><p>Check the author, text and image references.</p></div></li><li><span>2</span><div><h3>Make it yours</h3><p>Edit your token details. Import artwork only when you choose.</p></div></li><li><span>3</span><div><h3>Launch deliberately</h3><p>Save the draft, choose a fresh mint, then review and sign.</p></div></li></ol><dl className={styles.fees}><div><dt>OutSol platform fee</dt><dd>0%</dd></div></dl><p className="field-help mt-3">Network, account rent and protocol costs are shown before signing. Importing never launches a token.</p></section>

          <Link href="/extension" className={styles.extensionLink}><span><Link2 size={17} /><span>Capture from any public page<small>Explore the browser extension</small></span></span><ArrowRight size={17} /></Link>
        </aside>
      </div>
    </main><Footer />
  </div>
}
