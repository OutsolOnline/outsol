'use client'

import { useState, useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { MatchMode, validatePattern, getDifficultyLevel, getVanityController, type VanityRuntimeStatus } from '@/lib/vanity'
import { cn } from '@/lib/utils'

export interface VanityFormData {
  pattern: string
  mode: MatchMode
  caseSensitive: boolean
  threads: number
}

interface VanityGeneratorFormProps {
  onFormChange: (data: VanityFormData, isValid: boolean) => void
  disabled?: boolean
}

export function VanityGeneratorForm({
  onFormChange,
  disabled = false,
}: VanityGeneratorFormProps) {
  // Default to "pump" suffix like normal pump.fun coins
  const [pattern, setPattern] = useState('PUMP')
  const [mode, setMode] = useState<MatchMode>('suffix')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [threads, setThreads] = useState(4)
  const [maxThreads, setMaxThreads] = useState(8)
  const [runtime, setRuntime] = useState<VanityRuntimeStatus>(() => getVanityController().getRuntimeStatus())
  useEffect(() => {
    const available = typeof Worker === 'undefined' ? 1 : Math.max(1, Math.min(16, navigator.hardwareConcurrency || 8))
    setMaxThreads(available)
    setThreads(previous => Math.min(previous, available))
    const controller = getVanityController()
    setRuntime(controller.getRuntimeStatus())
    return controller.subscribeRuntime(setRuntime)
  }, [])

  const validation = useMemo(() => validatePattern(pattern), [pattern])
  const difficulty = useMemo(
    () => getDifficultyLevel(pattern.length),
    [pattern.length]
  )

  useEffect(() => {
    onFormChange(
      { pattern, mode, caseSensitive, threads },
      validation.isValid && pattern.length > 0
    )
  }, [pattern, mode, caseSensitive, threads, validation.isValid, onFormChange])

  return (
    <div className="space-y-10">
      {/* Pattern Input - line style */}
      <div className="space-y-3">
        <div className="flex items-center gap-4">
          <Label className="text-muted text-sm font-light">pattern</Label>
          {validation.isValid && pattern.length > 0 && (
            <span className="text-muted text-xs font-light">
              {difficulty.level}
            </span>
          )}
        </div>
        <Input
          placeholder="PUMP"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          disabled={disabled}
          variant="line"
          className="text-xl tracking-wide"
        />
        
        {/* Validation message */}
        {!validation.isValid && pattern.length > 0 && (
          <p className="text-muted text-sm font-light">
            invalid characters: {validation.invalidChars.join(', ')}
          </p>
        )}

        {/* Warning for long patterns */}
        {validation.warnings.length > 0 && (
          <p className="text-muted text-sm font-light">
            {validation.warnings[0]}
          </p>
        )}
      </div>

      {/* Mode selection - horizontal pills */}
      <div className="space-y-3">
        <Label className="text-muted text-sm font-light">match mode</Label>
        <div className="flex items-center gap-2">
          {(['prefix', 'suffix', 'contains'] as MatchMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              disabled={disabled}
              className={cn(
                'px-5 py-2 text-sm font-light rounded-terminal transition-all duration-300',
                mode === m
                  ? 'bg-foreground text-background'
                  : 'bg-surface border border-border text-muted hover:text-foreground hover:border-muted'
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Settings row - horizontal flow */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-8">
        {/* Case sensitivity */}
        <div className="flex items-center gap-4">
          <Label className="text-muted text-sm font-light">case sensitive</Label>
          <Switch
            checked={caseSensitive}
            onCheckedChange={setCaseSensitive}
            disabled={disabled}
          />
        </div>

        {/* Divider */}
        <div className="hidden sm:block h-4 w-px bg-muted-dim" />

        {/* Thread count */}
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <Label className="text-muted text-sm font-light whitespace-nowrap">
            requested workers: {threads}
          </Label>
          <Slider
            value={[threads]}
            onValueChange={(value) => setThreads(value[0])}
            min={1}
            max={maxThreads}
            step={1}
            disabled={disabled}
            className="w-32 max-w-full"
          />
        </div>
      </div>
      <p className="text-muted-dim text-sm" role="status">
        {runtime.mode === 'main-thread'
          ? 'Running with 1 cooperative browser task. Background workers are unavailable.'
          : runtime.mode === 'workers'
            ? runtime.activeWorkers > 0 ? `Running with ${runtime.activeWorkers} browser worker${runtime.activeWorkers === 1 ? '' : 's'}. Keys stay on this device.` : 'Starting browser workers…'
            : 'Browser workers run locally. If unavailable, generation uses one cooperative browser task.'}
      </p>
    </div>
  )
}
