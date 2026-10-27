/** Bound remote calls, including calls whose underlying client has no abort API. */
export async function withTimeout<T>(operation: Promise<T>, timeoutMs = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

export async function fetchBounded<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController()
  try {
    return await withTimeout(fetch(url, { ...init, signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Remote service returned HTTP ${response.status}`)
      return read(response)
    }), timeoutMs)
  } finally { controller.abort() }
}
