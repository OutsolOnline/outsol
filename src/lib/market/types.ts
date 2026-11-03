export interface TokenTrade {
 id:string;signature:string;ordinal:number;slot:number;timestamp:number;wallet:string;side:'buy'|'sell'
 tokenAmountRaw:string;solAmountLamports:string;feeLamports:string;creatorFeeLamports:string;priceSol:number
}
export interface MarketCandle {timestamp:number;open:number;high:number;low:number;close:number;volumeSol:number;trades:number}
export interface SampledOwner {owner:string;amountRaw:string;accounts:number;supplyPct:number}
export interface TokenAccountDistribution {
 status:'ready'|'unavailable';owners:SampledOwner[];sampledAccounts:number;sampledAmountRaw:string;sampledSupplyPct:number|null;slot:number|null
}
export interface TokenBalanceChange {
 signature:string;mint:string;slot:number;timestamp:number;wallet:string;decimals:number;kind:'buy'|'sell'|'transfer'|'mixed'
 tokenBeforeRaw:string;tokenAfterRaw:string;tokenDeltaRaw:string;nativeDeltaLamports:string|null;wrappedSolDeltaLamports:string;networkFeeLamports:string
 accountReserveDeltaLamports:string|null;tradeCashflowLamports:string|null;basisEligible:boolean;reason?:string
}
export interface TokenMarketSnapshot {
 status:'ready'|'unavailable'|'unsupported';mint:string;fetchedAt:string;decimals:number|null;supplyRaw:string|null;curveStatus:'active'|'graduated'|'unverified'
 trades:TokenTrade[];candles:MarketCandle[];distribution:TokenAccountDistribution;balanceChanges:TokenBalanceChange[]
 coverage:{kind:'recent'|'receipts';requested:number;read:number;missing:number;unsupported:number;failed:number;invalid:number;complete:false}
 warnings:string[]
}
