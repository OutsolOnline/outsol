import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {LaunchTokenTransfers,LaunchTransferDestination,formatTokenAmount} from '../src/components/launch/steps/LaunchTokenTransfers'

const transfer={walletId:'buyer',payer:'BuyerPublicAddressInFull',recipient:'RecipientPublicAddressInFull',mint:'MintPublicAddressInFull',tokenProgram:'TokenProgramInFull',rawAmount:'18446744073709551615',decimals:6}

describe('public launch token transfer display',()=>{
 it('labels the optional public-address field and associates public-only help with it',()=>{
  const html=renderToStaticMarkup(<LaunchTransferDestination id="recipient-buyer" buyerName="Buyer one" value="RecipientPublicAddressInFull" disabled={false} onChange={()=>{}}/>)
  expect(html).toContain('for="recipient-buyer"')
  expect(html).toContain('Send bought tokens to')
  expect(html).toContain('aria-describedby="recipient-buyer-help"')
  expect(html).toContain('id="recipient-buyer-help"')
  expect(html).toContain('public address only')
  expect(html).toContain('value="RecipientPublicAddressInFull"')
 })
 it.each([
  ['18446744073709551615',6,'18446744073709.551615'],
  ['1',9,'0.000000001'],
  ['1000000',6,'1'],
  ['42',0,'42'],
 ])('displays %s raw tokens at %i decimals exactly', (raw,decimals,expected)=>{
  expect(formatTokenAmount(raw,decimals)).toBe(expected)
 })
 it('reviews the exact purchase output and the full public sender and recipient',()=>{
  const html=renderToStaticMarkup(<LaunchTokenTransfers transfers={[transfer]} wallets={[{walletId:'buyer',name:'Buyer one'}]}/>)
  expect(html).toContain('18446744073709.551615')
  expect(html).toContain('RecipientPublicAddressInFull')
  expect(html).toContain('BuyerPublicAddressInFull')
  expect(html).toContain('Buyer one')
  expect(html).toContain('Token transfers in this bundle')
  expect(html).not.toContain('Transfers confirmed')
 })
 it('shows recorded intent without claiming a partial outcome confirmed its transfers',()=>{
  const html=renderToStaticMarkup(<LaunchTokenTransfers transfers={[transfer]} status="partial"/>)
  expect(html).toContain('Recorded token transfer intent')
  expect(html).toContain('/activity')
  expect(html).not.toContain('Transfers confirmed')
 })
 it('marks transfers confirmed only for a confirmed outcome and hides empty lists',()=>{
  expect(renderToStaticMarkup(<LaunchTokenTransfers transfers={[transfer]} status="confirmed"/>)).toContain('Transfers confirmed')
  expect(renderToStaticMarkup(<LaunchTokenTransfers transfers={[]}/>)).toBe('')
 })
})
