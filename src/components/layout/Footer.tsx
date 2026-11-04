import Link from 'next/link'
import { BrandMark } from './Brand'
import { TokenAddress } from './TokenAddress'
import { LAUNCHPIER_X_HANDLE, LAUNCHPIER_X_URL } from '@/lib/publicBrand'

export function Footer() {
  return <footer className="app-footer launchpier-contact-footer"><Link className="footer-brand" href="/" aria-label="LaunchPier home"><BrandMark />LaunchPier</Link><TokenAddress /><nav className="footer-socials" aria-label="LaunchPier resources"><Link href="/manual">How it works</Link><a href={LAUNCHPIER_X_URL} target="_blank" rel="noopener noreferrer">{LAUNCHPIER_X_HANDLE} ↗</a></nav></footer>
}
