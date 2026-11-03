import {PublicKey} from '@solana/web3.js'
import bs58 from 'bs58'
export function canonicalAddress(value:unknown):value is string {try{return typeof value==='string'&&value.length>=32&&value.length<=44&&new PublicKey(value).toBase58()===value}catch{return false}}
export function canonicalSignature(value:unknown):value is string {try{return typeof value==='string'&&value.length>=64&&value.length<=88&&bs58.decode(value).length===64}catch{return false}}
