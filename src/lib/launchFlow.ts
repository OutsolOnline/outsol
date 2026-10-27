import type { LaunchStep } from './pumpfun/types'
import { launchSelectionFromSearch } from './workspaceCatalog'
export const LAUNCH_STEP_ORDER: LaunchStep[] = ['metadata', 'select-mint', 'launch-settings', 'connect-wallet', 'sign-send', 'result']
/** Once saved, refresh resumes the draft instead of repeating the New launch action. */
export function savedLaunchUrl(query:string):string|null{
  const params=new URLSearchParams(query)
  if(params.get('new')!=='1')return null
  params.delete('new')
  return `/launch${params.size?`?${params}`:''}`
}
export function shouldStartNewLaunch(step: LaunchStep, query: URLSearchParams): boolean {
  return step === 'result' && (query.get('new') === '1' || Object.keys(launchSelectionFromSearch(query, 0)).length > 0)
}
