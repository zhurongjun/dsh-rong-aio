import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
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
  const connection = Reflect.get(ctx, 'connection') as HostConnectionHandle
  const sessions = Reflect.get(ctx, 'sessions') as unknown as SessionStore
  let tail = Promise.resolve()
  ctx.effect(() => () => tail)
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
        const task = tail.then(() => applyBatch(ctx, sessions, action, targets))
        tail = task.then(
          () => {},
          () => {},
        )
        return Response.json(await task)
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        )
      }
    },
  })
}
