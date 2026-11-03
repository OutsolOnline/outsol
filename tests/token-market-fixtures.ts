import {Keypair,PublicKey} from '@solana/web3.js'
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk'
import bs58 from 'bs58'
export const NOW=1_798_992_000_000, PUMP=PUMP_PROGRAM_ID.toBase58(), mint=Keypair.generate().publicKey.toBase58(), wallet=Keypair.generate().publicKey.toBase58(), signature=bs58.encode(new Uint8Array(64).fill(7))
const key=(value:string)=>new PublicKey(value).toBuffer()
const u64=(value:bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(value);return b}
const text=(value:string)=>{const b=Buffer.from(value),size=Buffer.alloc(4);size.writeUInt32LE(b.length);return Buffer.concat([size,b])}
export function tradeBytes(options:{mint?:string;wallet?:string;buy?:boolean;sol?:bigint;tokens?:bigint;quote?:string}={}){
 return Buffer.concat([Buffer.from([189,219,127,211,78,230,97,238]),key(options.mint??mint),u64(options.sol??1_000_000_000n),u64(options.tokens??100_000_000n),Buffer.from([options.buy===false?0:1]),key(options.wallet??wallet),u64(BigInt(NOW/1000)),u64(30_000_000_000n),u64(1_000_000_000n),u64(1_000_000_000n),u64(1_000_000_000n),key(wallet),u64(100n),u64(10_000_000n),key(wallet),u64(50n),u64(5_000_000n),Buffer.from([0]),u64(0n),u64(0n),u64(0n),u64(BigInt(NOW/1000)),text(options.buy===false?'sell':'buy'),Buffer.from([0]),u64(0n),u64(0n),u64(0n),u64(0n),Buffer.alloc(4),key(options.quote??PublicKey.default.toBase58()),u64(0n),u64(0n),u64(0n),u64(0n),u64(0n),u64(0n),u64(0n)]).toString('base64')
}
export function tx(logs?:string[],sig=signature){return {slot:100,blockTime:NOW/1000,transaction:{signatures:[sig],message:{accountKeys:[wallet]}},meta:{err:null,logMessages:logs??[`Program ${PUMP} invoke [1]`,`Program data: ${tradeBytes()}`,`Program ${PUMP} success`]}}}
