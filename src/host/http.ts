import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type * as z from 'zod'
import { errorMessage } from '../shared/error.ts'

const NO_STORE_HEADERS = { 'cache-control': 'no-store' } as const

export function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export class HttpError extends Error {
  readonly status: number
  readonly extra?: Record<string, unknown>

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE_HEADERS })
}

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
