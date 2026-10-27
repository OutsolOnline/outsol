'use client'

import { useEffect, useState } from 'react'

export function NetworkStatus() {
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    let controller: AbortController | undefined
    const check = async () => {
      controller?.abort()
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 10_000)
      try {
        const response = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }), signal: controller.signal })
        const data = await response.json()
        if (active) setOnline(response.ok && data.result === 'ok')
      } catch {
        if (active) setOnline(false)
      } finally { window.clearTimeout(timeout) }
    }
    void check()
    const interval = window.setInterval(() => { if (!document.hidden) void check() }, 60_000)
    return () => { active = false; controller?.abort(); window.clearInterval(interval) }
  }, [])

  const status = online === null ? 'Checking RPC connection' : online ? 'RPC connected' : 'RPC unavailable'
  return <div className={`network-status ${online === true ? 'is-online' : online === false ? 'is-offline' : ''}`} title={status} role="status"><span className="live-dot" aria-hidden="true" /><span>{online === false ? 'RPC unavailable' : 'Solana mainnet'}</span><span className="sr-only">{online === false ? '' : ` · ${status}`}</span></div>
}
