'use client'
import { Check } from 'lucide-react'
import type { LaunchStep } from '@/lib/pumpfun/types'
import styles from './LaunchBuilder.module.css'
const labels = ['Design', 'Prepare', 'Review', 'Launch']
const group = {metadata:0,'select-mint':1,'launch-settings':1,'connect-wallet':1,'sign-send':2,result:3} as const
export function StepIndicator({ currentStep }: { currentStep: LaunchStep }) {
  const current = group[currentStep]
  return <nav aria-label="Launch progress"><ol className={styles.steps}>{labels.map((step, index) => <li key={step} className={index === current ? styles.currentStep : index < current ? styles.completeStep : ''} aria-current={index === current ? 'step' : undefined}><span>{index < current ? <Check size={13} /> : index + 1}</span><b>{labels[index]}</b></li>)}</ol><div className={styles.mobileProgress}><div><span>{labels[current]}</span><small>Step {current + 1} of {labels.length}</small></div><div className={styles.mobileProgressTrack} role="progressbar" aria-label="Launch progress" aria-valuemin={0} aria-valuemax={labels.length} aria-valuenow={current + 1} aria-valuetext={labels[current]}><div style={{ width: `${(current + 1) / labels.length * 100}%` }} /></div></div></nav>
}
