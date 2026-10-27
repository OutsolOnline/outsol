/** Enforce a byte cap while streaming, before a large upstream body can accumulate. */
export async function readBoundedResponse(response: Response, limitBytes: number): Promise<string> {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) throw new Error('Invalid rehearsal response byte limit.')
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limitBytes) {
    void response.body?.cancel().catch(() => {})
    throw new Error('Rehearsal response exceeded its byte limit.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0, timedOut = false
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}) }, 10000)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (timedOut) throw new Error('Rehearsal response body timed out.')
      if (done) break
      total += value.byteLength
      if (total > limitBytes) {
        void reader.cancel().catch(() => {})
        throw new Error('Rehearsal response exceeded its byte limit.')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally { clearTimeout(timer); reader.releaseLock() }
}
