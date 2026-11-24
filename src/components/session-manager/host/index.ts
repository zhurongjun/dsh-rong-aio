import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session'
import * as z from 'zod'
import { errorMessage } from '../../../shared/error.ts'
import { createSerialQueue } from '../../../shared/serial-queue.ts'
import { API } from '../shared/protocol.ts'
import { listSessions, openDirectory } from './catalog.ts'
import { applyBatch } from './batch.ts'

export const inject = [
  'connection',
  'sessions',
  'sessionQuery',
  'sessionProjections',
  'sessionPersistence',
  'workspaceRegistry',
  'storageDomain',
  'loader',
]
const target = z.strictObject({ id: z.string().min(1), createdAt: z.number().int().nonnegative() })
const targets = z.array(target).min(1)
const command = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('open-directory'), target }),
  z.strictObject({ action: z.literal('delete'), confirmed: z.literal(true), targets }),
  z.strictObject({ action: z.enum(['archive', 'restore']), targets }),
])

export function apply(ctx: Context) {
  const connection = ctx.connection
  const sessions = ctx.sessions
  const queue = createSerialQueue('会话管理组件已停用')
  ctx.effect(() => () => queue.close())
  connection.fetch.register({
    path: API,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request.method === 'GET') {
          return Response.json(await listSessions(ctx, sessions, request.signal), {
            headers: { 'cache-control': 'no-store' },
          })
        }
        const body: unknown = await request.json().catch(() => undefined)
        const parsed = command.safeParse(body)
        if (!parsed.success)
          return Response.json({ error: '操作参数无效或尚未确认删除' }, { status: 400 })
        if (parsed.data.action === 'open-directory')
          return Response.json(await openDirectory(ctx, parsed.data.target, request.signal))
        const { action, targets } = parsed.data
        return Response.json(await queue.run(() => applyBatch(ctx, sessions, action, targets)))
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 500 })
      }
    },
  })
}
