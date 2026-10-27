'use client'

import { useMemo } from 'react'
import { VanityProgress, MatchMode, calculateProbability, estimateTime, formatProbability } from '@/lib/vanity'
import { formatNumber, formatDuration } from '@/lib/utils'

interface VanityStatsProps {
  progress: VanityProgress | null
  pattern: string
  mode: MatchMode
  caseSensitive: boolean
  isRunning: boolean
}

export function VanityStats({
  progress,
  pattern,
  mode,
  caseSensitive,
  isRunning,
}: VanityStatsProps) {
  const probability = useMemo(
    () => (pattern ? calculateProbability(pattern, mode, caseSensitive) : 0),
    [pattern, mode, caseSensitive]
  )

  const estimates = useMemo(() => {
    const aps = progress?.attemptsPerSecond || 10000
    return estimateTime(probability, aps)
  }, [probability, progress?.attemptsPerSecond])

  return (
    <div className="space-y-8">
      {/* Stats row - horizontal flow */}
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-3">
          <span className="text-muted text-sm font-light">speed</span>
          <span className="text-foreground font-mono text-sm tabular-nums">
            {progress ? `${formatNumber(progress.attemptsPerSecond)}/s` : '—'}
          </span>
        </div>

        <div className="w-px h-4 bg-muted-dim" />

        <div className="flex items-center gap-3">
          <span className="text-muted text-sm font-light">attempts</span>
          <span className="text-foreground font-mono text-sm tabular-nums">
            {progress ? formatNumber(progress.attempts) : '0'}
          </span>
        </div>

        <div className="w-px h-4 bg-muted-dim" />

        <div className="flex items-center gap-3">
          <span className="text-muted text-sm font-light">elapsed</span>
          <span className="text-foreground font-mono text-sm tabular-nums">
            {progress ? formatDuration(progress.elapsed) : '0s'}
          </span>
        </div>
      </div>

      {/* Probability and estimates */}
      {pattern && probability > 0 && (
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <span className="text-muted text-sm font-light">probability</span>
            <span className="text-foreground font-mono text-sm">
              {formatProbability(probability)}
            </span>
          </div>

          <div className="w-px h-4 bg-muted-dim" />

          <div className="flex items-center gap-3">
            <span className="text-muted text-sm font-light">expected</span>
            <span className="text-foreground font-mono text-sm tabular-nums">
              {isFinite(estimates.expectedSeconds)
                ? formatDuration(estimates.expectedSeconds)
                : '∞'}
            </span>
          </div>
        </div>
      )}

      {/* Running indicator - line animation */}
      {isRunning && (
        <div className="flex items-center gap-3">
          <div className="loader-line flex-1" />
          <span className="text-muted text-sm font-light">searching</span>
        </div>
      )}
    </div>
  )
}
