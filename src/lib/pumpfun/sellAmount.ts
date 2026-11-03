const MAX_U64=18446744073709551615n

/** An exact reviewed receipt amount never falls back to a wallet percentage. */
export function resolveSellAmountRaw(balance:bigint,sellPercent:number,exactSellAmountRaw?:string):bigint{
 if(balance<0n||balance>MAX_U64)throw new Error('The native token balance is invalid.')
 if(!Number.isFinite(sellPercent)||sellPercent<=0||sellPercent>100)throw new Error('Sell percentage must be above 0 and at most 100')
 if(exactSellAmountRaw!==undefined&&(typeof exactSellAmountRaw!=='string'||!/^[1-9]\d{0,19}$/.test(exactSellAmountRaw)))throw new Error('Review a canonical positive exact token amount.')
 const amount=exactSellAmountRaw===undefined?balance*BigInt(Math.floor(sellPercent*100))/10000n:BigInt(exactSellAmountRaw)
 if(amount<=0n||amount>MAX_U64||amount>balance)throw new Error('The exact native sale amount must be positive and no greater than the current token balance.')
 return amount
}
