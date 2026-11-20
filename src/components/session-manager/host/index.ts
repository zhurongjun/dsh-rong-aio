import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-workspace'
import { z } from 'zod'
import { API, type Outcome } from '../shared/protocol.ts'
import { listSessions, openDirectory } from './catalog.ts'
import { refreshSearchIndex, removeSession } from './remove.ts'

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
  const workspace = ctx.workspaceRegistry
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
        const task = tail.then(async () => {
          const outcomes: Outcome[] = []
          for (const target of new Map(targets.map((item) => [item.id, item])).values()) {
            const id = target.id as SessionId
            try {
              const live = sessions.get(id)
              if (action === 'delete' && live)
                throw new Error('会话仍被 DSH 占用；请在释放会话或重启 DSH 后重试')
              if (action === 'delete') await removeSession(ctx, id, target)
              else {
                const header = live?.header ?? (await ctx.sessionPersistence.stat(id))?.header
                if (header?.createdAt !== target.createdAt)
                  throw new Error('会话已变更或已移除，请刷新列表')
                if (action === 'archive') await workspace.archiveSession(id)
                else await workspace.unarchiveSession(id)
              }
              outcomes.push({ id })
            } catch (error) {
              outcomes.push({ id, error: error instanceof Error ? error.message : String(error) })
            }
          }
          const removed = action === 'delete' && outcomes.find((item) => !item.error)
          if (removed) {
            try {
              await refreshSearchIndex(ctx, removed.id as SessionId)
            } catch (error) {
              return {
                outcomes,
                warning:
                  '磁盘删除已完成，全文索引待同步。' +
                  (error instanceof Error ? error.message : String(error)),
              }
            }
          }
          return { outcomes }
        })
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
