import type {VenueLaunchInput,VenueLaunchPlan} from './types'
export type {NativeVenue,VenueLaunchInput,VenueLaunchPlan} from './types'

/** Only native on-chain builders. No remote signing API or referral account. */
export async function buildVenueLaunchPlan(input:VenueLaunchInput):Promise<VenueLaunchPlan>{
  if(input.venue==='raydium-launchlab'||input.venue==='bonk'){
    const {buildLaunchLabPlan}=await import('./launchlab')
    return buildLaunchLabPlan({...input,venue:input.venue})
  }
  if(input.venue==='meteora-dbc'){
    const {buildMeteoraPlan}=await import('./meteora')
    return buildMeteoraPlan({...input,venue:input.venue})
  }
  throw new Error('This native Solana venue is not supported')
}
