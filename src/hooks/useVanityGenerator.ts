'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Keypair } from '@solana/web3.js'
import {
  VanityConfig,
  VanityResult,
  VanityProgress,
  MatchMode,
  getVanityController,
  VanityControllerState,
} from '@/lib/vanity'

export interface UseVanityGeneratorOptions {
  pattern: string
  mode: MatchMode
  caseSensitive: boolean
  threads: number
  stopAfter?: number
}

export interface UseVanityGeneratorReturn {
  state: VanityControllerState
  progress: VanityProgress | null
  result: VanityResult | null
  error: string | null
  start: () => void
  stop: () => void
  reset: () => void
  keypair: Keypair | null
}

export function useVanityGenerator(
  options: UseVanityGeneratorOptions
): UseVanityGeneratorReturn {
  const [state, setState] = useState<VanityControllerState>('idle')
  const [progress, setProgress] = useState<VanityProgress | null>(null)
  const [result, setResult] = useState<VanityResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keypair, setKeypair] = useState<Keypair | null>(null)

  const controllerRef = useRef(getVanityController())

  const start = useCallback(() => {
    setError(null)
    setResult(null)
    setKeypair(null)
    setProgress(null)

    const config: VanityConfig = {
      pattern: options.pattern,
      mode: options.mode,
      caseSensitive: options.caseSensitive,
      threads: options.threads,
      stopAfter: options.stopAfter ?? 1,
    }

    controllerRef.current.start(config, {
      onProgress: (p) => {
        setProgress(p)
      },
      onFound: (r) => {
        try {
          const kp = Keypair.fromSecretKey(r.secretKey)
          if (kp.publicKey.toBase58() !== r.publicKey) throw new Error('Invalid generated keypair')
          setResult(r)
          setKeypair(kp)
        } catch {
          setError('Invalid keypair generated')
        }
      },
      onError: (e) => {
        setError(e)
      },
      onStateChange: (s) => {
        setState(s)
      },
    })
  }, [options])

  const stop = useCallback(() => {
    controllerRef.current.stop()
  }, [])

  const reset = useCallback(() => {
    controllerRef.current.stop()
    setState('idle')
    setProgress(null)
    setResult(null)
    setError(null)
    setKeypair(null)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    const controller = controllerRef.current
    return () => {
      controller.destroy()
    }
  }, [])

  return {
    state,
    progress,
    result,
    error,
    start,
    stop,
    reset,
    keypair,
  }
}
