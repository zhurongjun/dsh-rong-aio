/** 统一客户端 JSON HTTP 请求，安全处理非 JSON 错误响应并保留结构化错误字段。 */

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
  fallbackError?: string
}

async function parseJsonResponse(response: Response, fallbackError: string): Promise<unknown> {
  const text = await response.text()
  let data: unknown
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      if (!response.ok) throw new Error(fallbackError)
      throw new Error(fallbackError)
    }
  }
  if (!response.ok) {
    const record =
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined
    const message = typeof record?.error === 'string' && record.error ? record.error : fallbackError
    const failure = new Error(message)
    if (record && 'code' in record) Object.assign(failure, { code: record.code })
    if (record && 'details' in record) Object.assign(failure, { details: record.details })
    throw failure
  }
  if (data === undefined) throw new Error(fallbackError)
  return data
}

/** 发起无缓存 JSON 请求；非 2xx 或格式异常统一抛出可读 Error。 */
export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, headers, fallbackError = '请求失败，请重试' } = options
  const merged: Record<string, string> = { ...headers }
  if (body !== undefined && !('content-type' in merged)) {
    merged['content-type'] = 'application/json'
  }
  const response = await fetch(url, {
    method,
    signal,
    cache: 'no-store',
    ...(Object.keys(merged).length ? { headers: merged } : {}),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return (await parseJsonResponse(response, fallbackError)) as T
}

export type ConditionalResult<T> = { modified: false } | { modified: true; data: T; etag?: string }

/** 发起支持 ETag / 304 Not Modified 的只读 JSON GET 请求。 */
export async function requestConditionalJson<T>(
  url: string,
  options: { etag?: string; signal?: AbortSignal; fallbackError?: string } = {},
): Promise<ConditionalResult<T>> {
  const { etag, signal, fallbackError = '请求失败，请重试' } = options
  const headers = etag ? { 'if-none-match': etag } : undefined
  const response = await fetch(url, {
    method: 'GET',
    signal,
    cache: 'no-store',
    ...(headers ? { headers } : {}),
  })
  if (response.status === 304) return { modified: false }
  const data = (await parseJsonResponse(response, fallbackError)) as T
  return {
    modified: true,
    data,
    etag: response.headers.get('etag') ?? undefined,
  }
}
