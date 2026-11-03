'use client'
import {useLaunchStore} from '@/stores/launchStore'
import {PumpSignSendStep} from './PumpSignSendStep'
import {PumpBundleSignSendStep} from './PumpBundleSignSendStep'
import {usesAutomaticLaunchBuyers} from '@/lib/launchBundle/types'
export function SignSendStep({assertCanLaunch}:{assertCanLaunch?:()=>void}={}){
 const settings=useLaunchStore(state=>state.bundleSettings)
 return usesAutomaticLaunchBuyers(settings)?<PumpBundleSignSendStep assertCanLaunch={assertCanLaunch}/>:<PumpSignSendStep assertCanLaunch={assertCanLaunch}/>
}
