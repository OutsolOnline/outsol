import type { WalletVault } from '../walletVault'
export const WALLET_LIBRARY_KEY = 'outsol-wallet-library-v1'
export const WALLET_LIBRARY_LOCK = 'outsol-wallet-library-write-v1'
export const MAX_LIBRARY_WALLETS = 100
export const MAX_WALLET_BATCH = 20
export const MAX_GROUP_WALLETS = 20
export interface WalletSummary { id:string; name:string; publicKey:string; createdAt:string }
export interface WalletLibraryGroup { id:string; name:string; walletIds:string[]; createdAt:string; updatedAt:string }
export interface StoredLibraryWallet extends WalletSummary { vault:WalletVault }
export interface WalletLibraryRecord { version:1; revision:number; wallets:StoredLibraryWallet[]; groups:WalletLibraryGroup[]; legacyImported:boolean }
export interface WalletLibraryStorage { getItem(key:string):string|null; setItem(key:string,value:string):void }
export interface WalletLibraryLocks { request<T>(name:string,options:{ifAvailable:true},callback:(lock:object|null)=>Promise<T>):Promise<T> }
export interface WalletBatchInput { prefix:string; groupId?:string; passphrase:string }
