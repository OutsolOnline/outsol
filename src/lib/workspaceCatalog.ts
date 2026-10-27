import type { LaunchConfig, LaunchMode, LaunchVenue } from './launchConfig'

export interface WorkspaceTool { id: string; title: string; description: string; href: string; category: 'Create' | 'Operate' | 'Prepare'; icon: string; tags: string[];status?:'coming-soon';venue?:LaunchVenue }
export const LAUNCH_SHORTCUTS: { id: string; title: string; description: string; href: string; mode: LaunchMode; venue?: LaunchVenue; accent: string }[] = [
  { id: 'pump', title: 'Pump.fun', description: 'Bonding curve launch with an optional first buy.', href: '/launch?mode=standard&venue=pump', mode: 'standard', venue: 'pump', accent: 'mint' },
]
export const WORKSPACE_TOOLS: WorkspaceTool[] = [
  {id:'extension',title:'Browser extension',description:'Capture a page, selection or image reference and review a fresh launch draft.',href:'/extension',category:'Prepare',icon:'Puzzle',tags:['chrome','edge','download','browser','extension','web','post']},
  {id:'x-launch',title:'Launch from X',description:'Import a public post or connect your account, then review a separate Pump.fun launch draft.',href:'/x',category:'Prepare',icon:'Radio',tags:['twitter','X','tweet','post','social','account','connect','rapidlaunch']},
  {id:'multi-launch',title:'Multi-launch',description:'Prepare two to five fresh Pump tokens and review the cost of every launch.',href:'/multi-launch',category:'Create',venue:'pump',icon:'Layers',tags:['multi','batch','deploy','duplicate','launch']},
  {id:'discovery',title:'Launch discovery',description:'Watch a recent window of confirmed Pump launches and review a token before trading.',href:'/sniper',category:'Operate',icon:'Radio',tags:['sniper','snipe','watch','feed','new tokens','discover']},
  {id:'automations',title:'Trading sessions',description:'Configure bounded DCA, SOL-cap triggers and confirmed-launch auto-buys.',href:'/automations',category:'Operate',icon:'SlidersHorizontal',tags:['DCA','limit','market cap','sell','buy','sniper','automation','trigger']},
  {id:'tracker',title:'X tracker',description:'Account watchlists and post alerts are coming soon. Import a public post in Launch from X today.',href:'/tracker',category:'Prepare',icon:'Radio',tags:['twitter','X','track','post','social','alert','rapidlaunch'],status:'coming-soon'},
  { id:'planner',title:'Launch planner',description:'Choose a compatible Pump.fun plan and review your SOL budget.',href:'/planner',category:'Prepare',icon:'Compass',tags:['plan','budget','cost','goal'] },
  { id:'rehearse',title:'Launch rehearsal',description:'Execute Pump.fun creation with simulated SOL and inspect the result.',href:'/rehearse',category:'Prepare',icon:'FlaskConical',tags:['local','simulation','test','practice'] },
  { id:'projects',title:'Token workspaces',description:'Return to token facts, holdings, operations and saved notes.',href:'/projects',category:'Operate',icon:'FolderOpen',tags:['project','control center','verify','supply','authority'] },
  { id:'wallet-operations',title:'Transfers & cleanup',description:'Review individual SOL transfers, token distributions and eligible account cleanup.',href:'/wallet-operations?view=manual',category:'Operate',icon:'Wallet',tags:['send','withdraw','fund','recipient','empty accounts','transfer'] },
  ...LAUNCH_SHORTCUTS.map(item => ({ id: item.id, title: item.title, description: item.description, href: item.href, category: 'Create' as const, venue:item.venue, icon: item.id === 'lock' ? 'LockKeyhole' : item.id === 'liquidity' ? 'Droplets' : 'Rocket', tags: ['launch', 'token', item.venue || item.mode] })),
  { id: 'bundles', title: 'Wallet bundles', description: 'Coordinate a Pump.fun launch with Atomic / block zero, After confirmation or Organic wallet buys.', href: '/bundler', category: 'Operate', icon: 'Layers', tags: ['bundler', 'wallet', 'execution', 'atomic', 'block zero', 'block0', 'after confirmation', 'organic', 'intervals'] },
  { id: 'manage', title: 'Token management', description: 'Check holdings and preview native Pump buys or sells.', href: '/manage', category: 'Operate', icon: 'ArrowLeftRight', tags: ['trade', 'balance', 'buy', 'sell'] },
  { id: 'activity', title: 'Activity', description: 'Find launch and trade receipts and check pending operations.', href: '/activity', category: 'Operate', icon: 'Activity', tags: ['history', 'transaction', 'receipt', 'recovery'] },
  { id: 'drafts', title: 'Saved drafts', description: 'Save, duplicate and resume your public token designs.', href: '/drafts', category: 'Prepare', icon: 'FolderOpen', tags: ['preset', 'template', 'metadata', 'design'] },
  { id: 'artwork', title: 'Artwork library', description: 'Save, find and reuse token artwork on this device.', href: '/artwork', category: 'Prepare', icon: 'Images', tags: ['image', 'library', 'crop', 'design', 'assets'] },
  { id: 'vanity', title: 'Vanity studio', description: 'Generate a custom mint address locally with parallel workers.', href: '/vanity', category: 'Prepare', icon: 'Sparkles', tags: ['address', 'prefix', 'suffix', 'generate'] },
  { id: 'wallet', title: 'Wallets & groups', description: 'Create or bulk import encrypted wallets, organize groups and review group funding or withdrawals.', href: '/wallet', category: 'Prepare', icon: 'Wallet', tags: ['keys', 'backup', 'encrypt', 'import', 'bulk', 'group', 'fund', 'withdraw'] },
  { id: 'inspect', title: 'Wallet inspector', description: 'Read balances, find empty accounts and inspect potential account rent.', href: '/inspect', category: 'Prepare', icon: 'ScanLine', tags: ['scan', 'empty accounts', 'rent', 'health', 'tokens'] },
]
export function searchWorkspaceTools(query: string, category?: string): WorkspaceTool[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return WORKSPACE_TOOLS.filter(tool => (!category || category === 'All' || tool.category === category) && words.every(word => `${tool.title} ${tool.description} ${tool.category} ${tool.tags.join(' ')}`.toLowerCase().includes(word)))
}
export function launchSelectionFromSearch(query: URLSearchParams, now: number): Partial<LaunchConfig> {
  const mode = query.get('mode'), venue = query.get('venue')
  if (!Number.isFinite(now) || (mode && mode !== 'standard') || (venue && venue !== 'pump')) return {}
  return {
    ...(mode ? { mode: 'standard' as const } : {}),
    ...(venue ? { venue: 'pump' as const } : {}),
  }
}
