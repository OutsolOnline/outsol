import { afterEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { DEFAULT_LAUNCH_CONFIG, validateLaunchConfig } from '../src/lib/launchConfig'
import { createLaunchDraft, loadLaunchDrafts, saveLaunchDraft } from '../src/lib/launchDrafts'
import { PENDING_KEY, RECEIPTS_KEY, publicPending, readPending, samePending, saveConfirmed, savePending } from '../src/lib/launchHistory'
import { resolveCreatorFeeRouting } from '../src/lib/creatorFeeRouting'
import { createGitHubRecipientHandler, resolveGitHubIndividual } from '../src/lib/server/githubRecipient'
import { assertGitHubIdentityUnchanged, fetchGitHubIndividual } from '../src/lib/githubRecipient'

const payer = Keypair.fromSeed(new Uint8Array(32).fill(71)).publicKey.toBase58()
const mint = Keypair.fromSeed(new Uint8Array(32).fill(72)).publicKey.toBase58()
const address = Keypair.fromSeed(new Uint8Array(32).fill(73)).publicKey.toBase58()
const draftInput = () => ({ name: 'Public design', metadata: { name: 'Token', symbol: 'TKN', description: '' }, metadataUri: '', config: { ...DEFAULT_LAUNCH_CONFIG } })
const id = '5f31f89e-dae8-4ac7-9996-37ced68b9a36'
afterEach(() => vi.unstubAllGlobals())

describe('creator fee public product boundaries', () => {
  it('migrates only absent fields in actual legacy JSON and preserves every previous setting', () => {
    const draft = createLaunchDraft(draftInput(), id, 1000)
    const legacy = JSON.parse(JSON.stringify(draft))
    delete legacy.config.creatorFeeSelection
    const raw = JSON.stringify([legacy])
    const storage = { getItem: () => raw, setItem: vi.fn() }
    expect(loadLaunchDrafts(storage)[0].config).toEqual({ ...legacy.config, creatorFeeSelection: { kind: 'deployer' } })
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it.each([null, {}, { kind: 'unknown' }, { kind: 'cashback' }, { kind: 'wallet', address: 'bad' }])('preserves corrupt stored selection without overwriting it: %j', selection => {
    const draft = createLaunchDraft(draftInput(), id, 1000)
    const raw = JSON.stringify([{ ...draft, config: { ...draft.config, creatorFeeSelection: selection } }])
    const storage = { getItem: () => raw, setItem: vi.fn() }
    expect(() => loadLaunchDrafts(storage)).toThrow(/preserve/i)
    expect(() => saveLaunchDraft(draft, storage)).toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('persists a recipient choice and rejects unsupported cashback in config validation', () => {
    const draft = createLaunchDraft({ ...draftInput(), config: { ...DEFAULT_LAUNCH_CONFIG, creatorFeeSelection: { kind: 'wallet', address } } }, id, 1000)
    expect(draft.config.creatorFeeSelection).toEqual({ kind: 'wallet', address })
    expect(validateLaunchConfig({ ...DEFAULT_LAUNCH_CONFIG, creatorFeeSelection: { kind: 'cashback' } }).join(' ')).toMatch(/6082|CashbackDeprecated/)
  })
  it('projects only checked routing and binds the pending identity to that routing', () => {
    const routing = resolveCreatorFeeRouting({ selection: { kind: 'wallet', address }, payer, mint })
    const pending = { mode: 'standard' as const, mint, payer, signatures: ['signature'], blockhash: 'blockhash', submittedAt: 'now', creatorFeeRouting: routing }
    expect(publicPending({ ...pending, secret: 'private', packets: ['opaque'] } as any).creatorFeeRouting).toEqual(routing)
    expect(JSON.stringify(publicPending(pending))).not.toMatch(/private|opaque/)
    expect(samePending(pending, { ...pending, creatorFeeRouting: resolveCreatorFeeRouting({ selection: { kind: 'deployer' }, payer, mint }) })).toBe(false)
    expect(samePending(pending, { ...pending, creatorFeeRouting: undefined })).toBe(false)
    expect(() => publicPending({ ...pending, creatorFeeRouting: { ...routing, effectiveCreator: payer } })).toThrow()
    expect(() => publicPending({ ...pending, payer: address })).toThrow()
    expect(publicPending({ ...pending, creatorFeeRouting: undefined })).not.toHaveProperty('creatorFeeRouting')
  })
  it('never overwrites malformed stored routing during a later pending save', () => {
    const raw = JSON.stringify({ mode: 'standard', mint, payer, signatures: ['signature'], blockhash: 'blockhash', submittedAt: 'now', creatorFeeRouting: { selection: { kind: 'unknown' } } })
    const storage = { getItem: (key: string) => key === PENDING_KEY ? raw : null, setItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    expect(() => savePending({ mode: 'standard', mint, payer, signatures: ['new'], blockhash: 'new-blockhash', submittedAt: 'now' })).toThrow(/preserve/)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('round trips a routed public pending journal into a receipt without packets, signers, or API responses', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
    const creatorFeeRouting = resolveCreatorFeeRouting({ selection: { kind: 'github', username: 'alice' }, payer, mint, github: { userId: '12345', username: 'Alice', profileUrl: 'https://github.com/Alice', accountType: 'User' } })
    const pending = { mode: 'standard' as const, venue: 'pump' as const, mint, payer, signatures: ['signature'], blockhash: 'blockhash', submittedAt: 'now', creatorFeeRouting, packets: ['opaque-packet'], secretKey: 'private-key', apiResponse: { token: 'private-token' } }
    savePending(pending)
    expect(readPending()?.creatorFeeRouting).toEqual(creatorFeeRouting)
    const receipt = saveConfirmed(readPending()!)
    expect(receipt.creatorFeeRouting).toEqual(creatorFeeRouting)
    expect(JSON.parse(values.get(RECEIPTS_KEY)!)[0].creatorFeeRouting).toEqual(creatorFeeRouting)
    expect(Array.from(values.values()).join('')).not.toMatch(/opaque-packet|private-key|private-token|packets|secretKey|apiResponse/)
    expect(readPending()).toBeNull()
  })
})

describe('official GitHub individual resolution', () => {
  function stub(body: unknown, status = 200) { return vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status }))) }
  it('uses one fixed unauthenticated endpoint and projects canonical public identity', async () => {
    stub({ id: 12345, login: 'Alice', type: 'User', html_url: 'https://github.com/Alice', email: 'unused', token: 'private' })
    expect(await resolveGitHubIndividual('alice')).toEqual({ userId: '12345', username: 'Alice', profileUrl: 'https://github.com/Alice', accountType: 'User' })
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.github.com/users/alice')
    expect(options).toMatchObject({ redirect: 'error', cache: 'no-store' })
    expect(JSON.stringify(options)).not.toMatch(/Authorization|Bearer|token/)
  })
  it.each(['Organization', 'Bot'])('rejects non-individual account %s', async type => {
    stub({ id: 12345, login: 'alice', type, html_url: 'https://github.com/alice' })
    await expect(resolveGitHubIndividual('alice')).rejects.toThrow(/individual/)
  })
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '123', '0'.repeat(21)])('rejects unsafe or non-numeric public API IDs %s', async id => {
    stub({ id, login: 'alice', type: 'User', html_url: 'https://github.com/alice' })
    await expect(resolveGitHubIndividual('alice')).rejects.toThrow()
  })
  it.each(['alice/repository', 'https://github.com/alice', '../alice', '-alice', 'alice-', 'alice--name', 'a'.repeat(40)])('rejects invalid input without fetching %s', async username => {
    stub({})
    await expect(resolveGitHubIndividual(username)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects renamed profiles, noncanonical profile hosts and oversized bodies', async () => {
    stub({ id: 12345, login: 'renamed', type: 'User', html_url: 'https://github.com/renamed' })
    await expect(resolveGitHubIndividual('alice')).rejects.toThrow(/changed|match|renamed/i)
    stub({ id: 12345, login: 'alice', type: 'User', html_url: 'https://evil.example/alice' })
    await expect(resolveGitHubIndividual('alice')).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(70_000))))
    await expect(resolveGitHubIndividual('alice')).rejects.toThrow(/large|limit/i)
  })
  it.each([301, 404, 403, 429, 500])('keeps failed or redirected resolution explicit (%s)', async status => {
    stub({}, status)
    await expect(resolveGitHubIndividual('alice')).rejects.toThrow()
  })
  it('honors cancellation while an official API request is outstanding', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }))))
    const pending = resolveGitHubIndividual('alice', controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/cancelled/)
  })
  it('bounds official upstream requests even if GitHub does not answer', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')))
    stub({})
    await expect(resolveGitHubIndividual('alice')).rejects.toThrow(/timed out/)
    expect(fetch).not.toHaveBeenCalled()
    timeout.mockRestore()
  })
  it('API returns only a public identity and refuses arbitrary query fields before HTTP', async () => {
    stub({ id: 12345, login: 'alice', type: 'User', html_url: 'https://github.com/alice', token: 'not-returned' })
    const handler = createGitHubRecipientHandler()
    const response = await handler(new Request('https://outsol.test/api/github/recipient?username=alice'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ recipient: { userId: '12345', username: 'alice', profileUrl: 'https://github.com/alice', accountType: 'User' } })
    vi.mocked(fetch).mockClear()
    expect((await handler(new Request('https://outsol.test/api/github/recipient?username=alice&url=https://evil.test'))).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects a late browser lookup after the recipient input has been cancelled or edited', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
    const controller = new AbortController()
    const pending = fetchGitHubIndividual('alice', controller.signal)
    controller.abort()
    finish(Response.json({ recipient: { userId: '12345', username: 'alice', profileUrl: 'https://github.com/alice', accountType: 'User' } }))
    await expect(pending).rejects.toThrow()
  })
  it('invalidates approval when a previously displayed numeric identity changes', () => {
    const previous = { userId: '12345', username: 'alice', profileUrl: 'https://github.com/alice', accountType: 'User' as const }
    expect(() => assertGitHubIdentityUnchanged(previous, { ...previous, userId: '12346', username: 'Alice', profileUrl: 'https://github.com/Alice' })).toThrow(/different numeric user ID/)
    expect(() => assertGitHubIdentityUnchanged(previous, previous)).not.toThrow()
  })
})
