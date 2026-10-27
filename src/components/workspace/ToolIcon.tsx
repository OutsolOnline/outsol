import { Activity, ArrowLeftRight, Droplets, FolderOpen, Layers, LockKeyhole, Rocket, ScanLine, Sparkles, Wallet, Puzzle, Radio, SlidersHorizontal } from 'lucide-react'
const icons = { Activity, ArrowLeftRight, Droplets, FolderOpen, Layers, LockKeyhole, Rocket, ScanLine, Sparkles, Wallet, Puzzle, Radio, SlidersHorizontal }
export function ToolIcon({ name, size = 20 }: { name: string; size?: number }) { const Icon = icons[name as keyof typeof icons] || Rocket; return <Icon size={size} strokeWidth={1.7} aria-hidden="true" /> }
