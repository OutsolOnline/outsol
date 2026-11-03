import {PublicKey} from '@solana/web3.js'

/** Public mainnet constants and seeds from the pinned official SDK13.4.0.
 * Keep receipt parsing and Activity independent of the transaction SDK barrel.
 * A behavior test cross-checks every constant and nonce boundary against it. */
export const LOCK_PROGRAM=new PublicKey('strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m')
export const LOCK_ORACLE=new PublicKey('B743wFVk2pCYhV91cn287e1xY7f1vt4gdY48hhNiuQmT')
export const LOCK_ORACLE_PROGRAM=new PublicKey('pardpVtPjC8nLj1Dwncew62mUzfChdCX1EaoZe8oCAa')
export const LOCK_WITHDRAWOR=new PublicKey('wdrwhnCv4pzW8beKsbPa4S2UDZrXenjg16KJdKSpb5u')
const metadataSeed=new TextEncoder().encode('strm-met'),escrowSeed=new TextEncoder().encode('strm')
export function lockAddresses(input:{mint:string;payer:string},nonce:number):{metadata:string;escrow:string}{
 if(!Number.isInteger(nonce)||nonce<0||nonce>4294967295)throw new Error('Invalid lock identity.')
 const nonceSeed=new Uint8Array(4);new DataView(nonceSeed.buffer).setUint32(0,nonce,false)
 const metadata=PublicKey.findProgramAddressSync([metadataSeed,new PublicKey(input.mint).toBytes(),new PublicKey(input.payer).toBytes(),nonceSeed],LOCK_PROGRAM)[0],escrow=PublicKey.findProgramAddressSync([escrowSeed,metadata.toBytes()],LOCK_PROGRAM)[0]
 return{metadata:metadata.toBase58(),escrow:escrow.toBase58()}
}
