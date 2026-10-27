'use client'

import {useBundlerStore} from '@/stores/bundlerStore'
import {Button} from '@/components/ui'

export function BundlerResult(){
  const {result,statusMessage,isExecuting,reset,reconcileResult}=useBundlerStore()
  if(!result&&!isExecuting)return null
  const signatures=result?.submittedSignatures??[result?.createSignature,...result?.buySignatures??[],result?.sellSignature,...result?.bundleSellSignatures??[]].filter((value):value is string=>!!value)
  const unknown=result?.status==='unknown'
  return <section className="space-y-4 rounded-lg border border-border bg-surface p-6" aria-live="polite">
    {isExecuting&&<p className="text-sm text-accent">{statusMessage}</p>}
    {result&&<>
      <h3 className={`font-medium ${result.success?'text-green-400':unknown?'text-yellow-400':'text-foreground'}`}>
        {result.success?'launch and selected actions confirmed':unknown?'confirmation pending — saved signatures below':result.status==='partial'?'launch recorded; some actions stopped':'launch stopped'}
      </h3>
      {result.error&&<p className="text-sm text-muted">{result.error}</p>}
      {unknown&&<p className="text-sm text-yellow-400">The launch may already have landed. Check these signatures before creating another token. The app will not resubmit them.</p>}
      {result.mintAddress&&<div><p className="text-sm text-muted">mint address</p><a className="break-all font-mono text-sm text-accent hover:underline" href={`https://pump.fun/${result.mintAddress}`} target="_blank" rel="noopener noreferrer">{result.mintAddress}</a></div>}
      {result.bundleId&&<div><p className="text-sm text-muted">Jito acknowledgement ID</p><p className="break-all font-mono text-xs">{result.bundleId}</p></div>}
      {signatures.length>0&&<div className="space-y-2"><p className="text-sm text-muted">saved transaction signatures ({signatures.length})</p><ul className="max-h-48 space-y-2 overflow-auto">{signatures.map((signature,index)=><li key={signature}><a className="break-all font-mono text-xs text-accent hover:underline" href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noopener noreferrer">{index+1}. {signature}</a></li>)}</ul></div>}
      {!isExecuting&&<div className="flex flex-wrap gap-3">
        {signatures.length>0&&<Button variant="secondary" onClick={()=>void reconcileResult()}>check saved transactions</Button>}
        {!unknown&&<Button variant="secondary" onClick={reset}>{result.createSignature?'prepare another launch':'clear form'}</Button>}
      </div>}
    </>}
  </section>
}
