import { afterEach, describe, expect, it, vi } from 'vitest'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { createLaunchAnnouncement, createXAnnouncementIntent, validateAnnouncementMint } from '../src/lib/launchAnnouncement'

const mint = Keypair.fromSeed(new Uint8Array(32).fill(17)).publicKey.toBase58()
afterEach(() => vi.restoreAllMocks())

describe('reviewed launch announcement', () => {
  it('prepares factual launch copy with the exact mint and public Pump.fun link', () => {
    const text = createLaunchAnnouncement({ mint, name: 'Orbit', symbol: 'ORB' })
    expect(text).toBe(`Orbit ($ORB) is now live on Pump.fun.\n\nMint: ${mint}\nhttps://pump.fun/coin/${mint}`)
    expect(text.length).toBeLessThanOrEqual(280)
  })

  it('uses a bounded plain label when metadata is missing or unusually long', () => {
    expect(createLaunchAnnouncement({ mint })).toContain('My token is now live')
    const text = createLaunchAnnouncement({ mint, name: '😀'.repeat(300) + '\u0000', symbol: 'A\nB' })
    expect(text.length).toBeLessThanOrEqual(280)
    expect(text).not.toContain('\u0000')
    expect(() => createXAnnouncementIntent(mint, text)).not.toThrow()
  })

  it('escapes edited text into the official X composer without extra navigation parameters', () => {
    const text = 'Orbit & friends #launch\nhttps://example.com/?x=1&next=two + 100% 😀'
    const url = new URL(createXAnnouncementIntent(mint, text))
    expect(url.origin + url.pathname).toBe('https://x.com/intent/post')
    expect([...url.searchParams.keys()]).toEqual(['text'])
    expect(url.searchParams.get('text')).toBe(text)
    expect(url.hash).toBe('')
  })

  it('rejects malformed, system and off-curve mint references', () => {
    const pda = PublicKey.findProgramAddressSync([Buffer.from('announcement-test')], SystemProgram.programId)[0].toBase58()
    for (const value of ['', 'not-a-mint', SystemProgram.programId.toBase58(), ` ${mint}`, pda, `https://pump.fun/coin/${mint}`]) {
      expect(() => validateAnnouncementMint(value)).toThrow()
      expect(() => createXAnnouncementIntent(value, 'Ready for review')).toThrow()
    }
    expect(validateAnnouncementMint(mint)).toBe(mint)
  })

  it('rejects blank, oversized, control and incomplete Unicode text before opening a composer', () => {
    for (const value of ['', '   \n', 'a'.repeat(281), '😀'.repeat(141), 'hello\u0000world', 'hello\tworld', 'hello\u007fworld', '\uD800']) expect(() => createXAnnouncementIntent(mint, value)).toThrow()
    expect(new URL(createXAnnouncementIntent(mint, 'a'.repeat(280))).searchParams.get('text')).toHaveLength(280)
    expect(new URL(createXAnnouncementIntent(mint, '😀'.repeat(140))).searchParams.get('text')).toBe('😀'.repeat(140))
  })

  it('creates review data without making network or publication requests', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    createXAnnouncementIntent(mint, createLaunchAnnouncement({ mint, name: 'Orbit' }))
    expect(fetcher).not.toHaveBeenCalled()
  })
})
