/** Public receipt shapes retained for the launch UI. Wallet secrets have no database representation. */
export interface VaniteWallet {
  id: string
  public_key: string
  created_at: string
  last_used_at: string | null
}

export interface VaniteLaunch {
  id: string
  wallet_public_key: string
  mint_address: string
  token_name: string
  token_symbol: string
  tx_signature: string
  sell_signature: string | null
  dev_buy_amount: number
  auto_sell_enabled: boolean
  created_at: string
}
