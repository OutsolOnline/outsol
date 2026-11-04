'use client'

import {useEffect,useState} from 'react'

export function PreviousWorkspaceNotice(){
 const [visible,setVisible]=useState(false)
 useEffect(()=>{setVisible(['launchpier.net','www.launchpier.net'].includes(window.location.hostname))},[])
 if(!visible)return null
 return <details className="workspace-card mb-5 text-sm"><summary className="cursor-pointer font-medium">Moving from OutSol or the Railway address?</summary><p className="text-muted leading-7 mt-3">Your wallets and drafts stay in the browser and site address where you created them. Your previous address still works. To move here, open it, save your private wallet backup and public designs, then import them on LaunchPier. Keep private keys and backups private.</p><div className="flex flex-wrap gap-4 mt-3"><a className="text-link" href="https://outsol.online/wallet" target="_blank" rel="noreferrer">Open previous OutSol wallets ↗</a><a className="text-link" href="https://vanity-production-2bbb.up.railway.app/wallet" target="_blank" rel="noreferrer">Open previous Railway wallets ↗</a><a className="text-link" href="/library">Import public designs</a></div></details>
}
