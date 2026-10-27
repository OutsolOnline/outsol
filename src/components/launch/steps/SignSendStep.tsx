'use client'
import {useLaunchStore} from '@/stores/launchStore'
import {PumpSignSendStep} from './PumpSignSendStep'
import {PumpBundleSignSendStep} from './PumpBundleSignSendStep'
export function SignSendStep(){
 const settings=useLaunchStore(state=>state.bundleSettings)
 return settings.mode!=='manual'||settings.wallets.some(wallet=>wallet.buySol>0)?<PumpBundleSignSendStep/>:<PumpSignSendStep/>
}
