import Link from 'next/link'
import { BrandMark } from './Brand'

export function Footer() {
  return <footer className="app-footer"><Link className="footer-brand" href="/" aria-label="LaunchPier home"><BrandMark />LaunchPier</Link><span>Your keys. Your control.</span><nav className="footer-socials" aria-label="LaunchPier resources"><Link href="/manual">How it works</Link><a href="https://github.com/OutsolOnline" target="_blank" rel="noreferrer">GitHub ↗</a><a href="https://x.com/OutSolOnline" target="_blank" rel="noreferrer">X ↗</a></nav></footer>
}
