import Link from 'next/link'
import { BrandMark } from './Brand'

export function Footer() {
  return <footer className="app-footer"><Link className="footer-brand" href="/" aria-label="OutSol home"><BrandMark />OutSol</Link><span>Your keys. Your control.</span><nav className="footer-socials" aria-label="OutSol community"><a href="https://github.com/OutsolOnline" target="_blank" rel="noreferrer">GitHub ↗</a><a href="https://x.com/OutSolOnline" target="_blank" rel="noreferrer">X ↗</a></nav></footer>
}
