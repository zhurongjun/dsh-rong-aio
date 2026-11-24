/** 统一宿主 JSON HTTP 端点：声明式注册、Zod 参数/请求体解析、ETag 协商与无缓存错误响应。 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type * as z from 'zod'
import { errorMessage } from '../shared/error.ts'

export const NO_STORE_HEADERS = { 'cache-control': 'no-store' } as const

/** 计算 UTF-8 文本的 SHA-256 hex 指纹。 */
export function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 显式指定 HTTP 状态码与附加协议字段的宿主请求异常。 */
export class HttpError extends Error {
  readonly status: number
  readonly extra?: Record<string, unknown>

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

/** 返回禁止缓存的 JSON 响应。 */
export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE_HEADERS })
}

/** 返回带强 ETag 协商能力的无缓存 JSON 响应；GET 命中 If-None-Match 时返回 304。 */
export function etagJsonResponse(request: Request, data: unknown): Response {
  const payload = JSON.stringify(data)
  const etag = `"${fingerprint(payload)}"`
  if (request.method === 'GET' && request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag, ...NO_STORE_HEADERS } })
  }
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json', ...NO_STORE_HEADERS, etag },
  })
}

/** 安全读取并校验 JSON 请求体；格式无效抛出 400 HttpError。 */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  invalidMessage: string,
): Promise<T> {
  const raw: unknown = await request.json().catch(() => undefined)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new HttpError(400, invalidMessage)
  return parsed.data
}

/** 解析并校验 URL 查询参数；参数无效抛出 400 HttpError。 */
export function parseQueryParams<T>(
  request: Request,
  schema: z.ZodType<T>,
  invalidMessage: string,
): T {
  const raw = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new HttpError(400, invalidMessage)
  return parsed.data
}

interface EndpointOptions {
  path: string
  methods?: ('GET' | 'POST')[]
  errorStatus?: number
  formatError?: (error: unknown) => { message: string; extra?: Record<string, unknown> }
  fetch: (request: Request) => Promise<Response>
}

/** 在 DSH connection.fetch 上注册带统一异常映射与无缓存头的 JSON 端点。 */
export function registerJsonEndpoint(ctx: Context, options: EndpointOptions): void {
  ctx.connection.fetch.register({
    path: options.path,
    methods: options.methods ?? ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        return await options.fetch(request)
      } catch (error) {
        if (error instanceof HttpError) {
          return jsonResponse({ error: error.message, ...error.extra }, error.status)
        }
        const formatted = options.formatError
          ? options.formatError(error)
          : { message: errorMessage(error) }
        return jsonResponse(
          { error: formatted.message, ...formatted.extra },
          options.errorStatus ?? 409,
        )
      }
    },
  })
}
