import { ArrowUpRight } from 'lucide-react'
import { LAUNCHPIER_TOKEN_ADDRESS, LAUNCHPIER_TOKEN_EXPLORER } from '@/lib/publicBrand'
import styles from './TokenAddress.module.css'

export function TokenAddress() {
  return <section className={styles.tokenAddress} aria-label="LaunchPier token address">
    <span className={styles.label}>LaunchPier token · Solana</span>
    <a href={LAUNCHPIER_TOKEN_EXPLORER} target="_blank" rel="noopener noreferrer" aria-label={`View LaunchPier token ${LAUNCHPIER_TOKEN_ADDRESS} on Solscan (opens in a new tab)`}>
      <span>{LAUNCHPIER_TOKEN_ADDRESS}</span><ArrowUpRight size={14} aria-hidden="true" />
    </a>
  </section>
}
