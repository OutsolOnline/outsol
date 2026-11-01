import {describe,it,expect} from 'vitest'
import {Keypair} from '@solana/web3.js'
import bs58 from 'bs58'
import {useBundlerStore} from '../src/stores/bundlerStore'
import {useLaunchStore} from '../src/stores/launchStore'
import {validateBundleConfig} from '../src/lib/bundler/api'
import {DEFAULT_LAUNCH_BUNDLE_SETTINGS} from '../src/lib/launchBundle/types'
function config(){const base=useBundlerStore.getState(),creator=Keypair.generate(),buyer=Keypair.generate();return{...base,tokenName:'Test',tokenSymbol:'T',tokenImage:new Blob(['x']) as File,creatorPrivateKey:bs58.encode(creator.secretKey),creatorPublicKey:creator.publicKey.toBase58(),sniperMode:'after_confirm' as const,bundleWallets:[{...base.bundleWallets[0],privateKey:bs58.encode(buyer.secretKey),publicKey:buyer.publicKey.toBase58(),buyAmount:.01,isValid:true,sellEnabled:false,transferTo:Keypair.generate().publicKey.toBase58()}]}}
describe('bundle relay settings',()=>{
 it('validates ordinary distinct recipients in every standalone execution mode',()=>{for(const mode of ['block0','after_confirm'] as const){const value={...config(),sniperMode:mode};expect(()=>validateBundleConfig(value)).not.toThrow();value.bundleWallets[0].transferTo=value.bundleWallets[0].publicKey!;expect(()=>validateBundleConfig(value)).toThrow(/recipient|receiving|different|destination/i)}})
 it('refuses source scheduled sells after its exact purchase was routed out',()=>{const value=config();value.bundleWallets[0].sellEnabled=true;expect(()=>validateBundleConfig(value)).toThrow(/recipient|Relay|routed/i)})
 it('keeps inline destinations when changing execution mode',()=>{const recipient=Keypair.generate().publicKey.toBase58(),settings={...DEFAULT_LAUNCH_BUNDLE_SETTINGS,groupId:'group',mode:'block0' as const,wallets:[{walletId:'buyer',publicKey:Keypair.generate().publicKey.toBase58(),name:'Buyer',buySol:.01,delaySeconds:0,transferTo:recipient}]};useLaunchStore.getState().setBundleSettings(settings);useLaunchStore.getState().setBundleSettings({...settings,mode:'organic'});expect(useLaunchStore.getState().bundleSettings.wallets[0].transferTo).toBe(recipient);useLaunchStore.getState().setBundleSettings(DEFAULT_LAUNCH_BUNDLE_SETTINGS)})
 it('lets a bundle destination be edited only before execution',()=>{const state=useBundlerStore.getState(),recipient=Keypair.generate().publicKey.toBase58();state.setBundleWalletTransferTo(0,recipient);expect(useBundlerStore.getState().bundleWallets[0].transferTo).toBe(recipient);useBundlerStore.setState({isExecuting:true});state.setBundleWalletTransferTo(0,undefined);expect(useBundlerStore.getState().bundleWallets[0].transferTo).toBe(recipient);useBundlerStore.setState({isExecuting:false});state.setBundleWalletTransferTo(0,undefined)})
})
