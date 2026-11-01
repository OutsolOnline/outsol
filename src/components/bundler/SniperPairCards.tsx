'use client'
import {useState,type ReactNode} from 'react'
import type {Keypair} from '@solana/web3.js'
import {ArrowRight,ArrowUpRight,Check,Copy,ExternalLink,LockKeyhole,RefreshCw} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {PrivateWalletBackup} from '@/components/wallet/PrivateWalletBackup'
import type {ResolvedSniperPair} from '@/lib/sniperPairs/catalog'
import type {WalletSummary} from '@/lib/walletLibrary/types'
import type {RelayWalletScan} from '@/lib/relay/types'
import {formatRawBalance} from '@/lib/venues/trade'
import styles from './SniperPairOperations.module.css'

interface Props{pairs:readonly ResolvedSniperPair[];scans:Record<string,RelayWalletScan>;scanErrors:Record<string,string>;busy:boolean;blocked:boolean;revision:string|number;getKeypair:(id:string)=>Keypair|null;onScan:(wallets:WalletSummary[])=>void;onSell:(pairIds?:readonly string[])=>void;onRelay:(pairIds:readonly string[])=>void;onUnlock:(wallets:WalletSummary[])=>void;renderPairSettings?:(pair:ResolvedSniperPair)=>ReactNode}
export function SniperPairCards({pairs,scans,scanErrors,busy,blocked,revision,getKeypair,onScan,onSell,onRelay,onUnlock,renderPairSettings}:Props){
 const [copied,setCopied]=useState(''),[copyError,setCopyError]=useState('')
 const copy=async(wallet:WalletSummary)=>{try{await navigator.clipboard.writeText(wallet.publicKey);setCopied(wallet.id);setCopyError('')}catch{setCopyError('Copy is unavailable. Select the full wallet address below and copy it manually.')}}
 const backups=(wallets:WalletSummary[])=>wallets.map(wallet=>({id:wallet.id,name:wallet.name,address:wallet.publicKey,readKeypair:()=>getKeypair(wallet.id)}))
 const allWallets=pairs.flatMap(pair=>[pair.sniper,pair.receiver])
 return <section className={styles.workspace} aria-label="Sniper pair operations">
  <div className={styles.toolbar}><div><strong>{pairs.length} {pairs.length===1?'pair':'pairs'} in this session</strong><p>Sales below use token receivers only.</p></div><div className={styles.actions}><Button variant="secondary" disabled={busy||!pairs.length} onClick={()=>onScan(allWallets)}><RefreshCw size={14}/>Refresh balances</Button><Button disabled={busy||blocked||!pairs.length} onClick={()=>onSell()}>Sell all receivers<ArrowUpRight size={14}/></Button></div></div>
  {copyError&&<p role="alert" className="notice notice-error">{copyError}</p>}
  {!pairs.length&&<div className={styles.empty}><h3>Your wallet pairs will appear here.</h3><p>Generate a session above or select saved pairs to reuse them. Nothing is funded automatically.</p></div>}
  <div className={styles.pairs}>{pairs.map(pair=><article className={styles.pair} key={pair.id} aria-label={`${pair.name} sniper pair`}>
   <header className={styles.pairHeader}><div><h3>{pair.name}</h3><p>Sniper <ArrowRight size={12}/> Token Receiver</p></div><div className={styles.actions}><Button variant="ghost" size="sm" disabled={busy} onClick={()=>onUnlock([pair.sniper,pair.receiver])}><LockKeyhole size={13}/>Unlock pair</Button><PrivateWalletBackup wallets={backups([pair.sniper,pair.receiver])} label="Export both keys" disabled={busy} revision={revision}/></div></header>
   {renderPairSettings&&<div className={styles.settings}>{renderPairSettings(pair)}</div>}
   <div className={styles.wallets}>{(['sniper','receiver'] as const).map(role=>{const wallet=pair[role],scan=scans[wallet.id],isReceiver=role==='receiver',key=getKeypair(wallet.id);return <section key={role} className={styles.wallet} aria-label={`${pair.name} ${isReceiver?'Token Receiver':'Sniper'}`}>
    <div className={styles.walletTitle}><h4>{pair.name} {isReceiver?'Token Receiver':'Sniper'}</h4><span>{key?'Unlocked':'Locked'}</span></div>
    <p className={styles.job}>{isReceiver?'Holds the tokens. Sales return SOL here.':'Buys your launch and forwards its purchased tokens.'}</p>
    <div className={styles.addressRow}><code title={wallet.publicKey}>{wallet.publicKey}</code><Button variant="ghost" size="sm" aria-label={`Copy ${pair.name} ${role} address`} onClick={()=>void copy(wallet)}>{copied===wallet.id?<Check size={14}/>:<Copy size={14}/>}</Button></div>
    <div className={styles.balance}><strong>{scan?`${formatRawBalance(scan.solLamports,9,9)} SOL`:'Balance not checked'}</strong><a href={`https://solscan.io/account/${wallet.publicKey}`} target="_blank" rel="noreferrer" aria-label={`Open ${pair.name} ${role} in explorer`}><ExternalLink size={13}/></a></div>
    <p className={styles.funding}>{isReceiver?'Fund with SOL for selling fees.':'Fund with your buy amount plus fees and recipient rent.'}</p>
    {scanErrors[wallet.id]&&<p role="alert" className={styles.failure}>{scanErrors[wallet.id]}</p>}
    {scan&&<div className={styles.holdings}>{scan.assets.length?scan.assets.map(asset=><div key={asset.account}><a href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer" title={asset.mint}>{asset.mint.slice(0,5)}…{asset.mint.slice(-5)}</a><span>{formatRawBalance(asset.amountRaw,asset.decimals,9)}</span>{!asset.eligible&&!asset.saleEligible&&<small>{asset.reason||'Unsupported token rules'}</small>}</div>):<p>No tokens in this wallet.</p>}</div>}
    <div className={styles.walletActions}><PrivateWalletBackup wallets={backups([wallet])} label="Export key / keypair" disabled={busy} revision={revision}/>{isReceiver?<Button variant="secondary" size="sm" disabled={busy||blocked} onClick={()=>onSell([pair.id])}>Sell {pair.name} receiver<ArrowUpRight size={13}/></Button>:<Button variant="secondary" size="sm" disabled={busy||blocked} onClick={()=>onRelay([pair.id])}>Send tokens to receiver<ArrowRight size={13}/></Button>}</div>
   </section>})}</div>
  </article>)}</div>
  <p className={styles.footnote}>Sell and send actions refresh balances and open a review before signing. Only supported tokens with an available market can sell. Your sniper wallets and deployer are excluded from these sales.</p>
 </section>
}
