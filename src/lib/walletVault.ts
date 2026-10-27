export interface WalletVault {
  version: 1
  publicKey: string
  salt: string
  iv: string
  ciphertext: string
  iterations: number
}

const ITERATIONS = 600_000
function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)) }
function decode(value: string): Uint8Array { return Uint8Array.from(atob(value), c => c.charCodeAt(0)) }

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptWalletSecret(secret: string, passphrase: string, publicKey: string): Promise<WalletVault> {
  if (passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(publicKey) }, key, new TextEncoder().encode(secret))
  return { version: 1, publicKey, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)), iterations: ITERATIONS }
}

export async function decryptWalletSecret(vault: WalletVault, passphrase: string): Promise<string> {
  if (typeof vault.salt !== 'string' || vault.salt.length > 64 || typeof vault.iv !== 'string' || vault.iv.length > 64 || typeof vault.ciphertext !== 'string' || vault.ciphertext.length > 4096) throw new Error('Invalid wallet vault.')
  if (vault.version !== 1 || vault.iterations !== ITERATIONS || decode(vault.salt).length !== 16 || decode(vault.iv).length !== 12) throw new Error('Unsupported wallet vault.')
  const key = await deriveKey(passphrase, decode(vault.salt), vault.iterations)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(vault.iv) as BufferSource, additionalData: new TextEncoder().encode(vault.publicKey) }, key, decode(vault.ciphertext) as BufferSource)
  return new TextDecoder().decode(plaintext)
}
