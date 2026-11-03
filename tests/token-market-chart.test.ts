import {describe,it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {MarketChart} from '../src/components/market/MarketChart'
import {decodeConfirmedPumpTrades} from '../src/lib/market/events'
import {NOW,mint,wallet,signature,tx} from './token-market-fixtures'
describe('accessible observed chart',()=>{
 it('draws own/watched event markers with the exact wallet label and no inferred empty price chart',()=>{
  const trade=decodeConfirmedPumpTrades(tx(),signature,mint,6,NOW/1000)[0]
  const html=renderToStaticMarkup(createElement(MarketChart,{candles:[{timestamp:Math.floor(trade.timestamp/60)*60,open:.01,high:.01,low:.01,close:.01,volumeSol:1,trades:1}],trades:[trade],markers:new Map([[wallet,{name:'Tracked wallet',kind:'watched' as const,color:'mint'}]])}))
  expect(html).toContain('Tracked wallet');expect(html).toContain('data-wallet-marker="watched"');expect(html).toContain('role="img"')
  const empty=renderToStaticMarkup(createElement(MarketChart,{candles:[]}));expect(empty).not.toContain('<svg');expect(empty).toContain('No confirmed curve trade prices')
 })
})
