'use strict'

const { Buffer } = require('buffer')
const MAX_BYTES = 1024

function inputBytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError('Expected an unsigned byte buffer')
  if (value.length > MAX_BYTES) throw new RangeError('Integer buffer exceeds the supported width')
  return value
}

function toBigIntLE(buffer) {
  const bytes = inputBytes(buffer)
  let result = 0n
  for (let index = bytes.length - 1; index >= 0; index--) result = (result << 8n) | BigInt(bytes[index])
  return result
}

function toBigIntBE(buffer) {
  const bytes = inputBytes(buffer)
  let result = 0n
  for (let index = 0; index < bytes.length; index++) result = (result << 8n) | BigInt(bytes[index])
  return result
}

function outputBytes(value, width, littleEndian) {
  if (typeof value !== 'bigint') throw new TypeError('Expected a bigint quantity')
  if (!Number.isSafeInteger(width) || width < 0 || width > MAX_BYTES) throw new RangeError('Width must be an integer from 0 to 1024 bytes')
  if (value < 0n || (value >> BigInt(width * 8)) !== 0n) throw new RangeError('Unsigned quantity does not fit the requested width')
  const buffer = Buffer.alloc(width)
  let remaining = value
  for (let index = 0; index < width; index++) {
    buffer[littleEndian ? index : width - index - 1] = Number(remaining & 255n)
    remaining >>= 8n
  }
  return buffer
}

function toBufferLE(value, width) { return outputBytes(value, width, true) }
function toBufferBE(value, width) { return outputBytes(value, width, false) }

exports.toBigIntLE = toBigIntLE
exports.toBigIntBE = toBigIntBE
exports.toBufferLE = toBufferLE
exports.toBufferBE = toBufferBE
