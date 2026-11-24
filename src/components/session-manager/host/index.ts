import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session'
import * as z from 'zod'
import { jsonResponse, parseJsonBody, registerJsonEndpoint } from '../../../host/http.ts'
import { createSerialQueue } from '../../../shared/serial-queue.ts'
import { API } from '../shared/protocol.ts'
import { listSessions, openDirectory } from './catalog.ts'
import { applyBatch } from './batch.ts'
import { installSessionOccupancy } from './occupancy.ts'

export const inject = [
  'agents',
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
  installSessionOccupancy(ctx)
  const queue = createSerialQueue('会话管理组件已停用')
  ctx.effect(() => () => queue.close())

  registerJsonEndpoint(ctx, {
    path: API,
    errorStatus: 500,
    async fetch(request) {
      if (request.method === 'GET') {
        return jsonResponse(await listSessions(ctx, ctx.sessions, request.signal))
      }

      const data = await parseJsonBody(request, command, '操作参数无效或尚未确认删除')
      if (data.action === 'open-directory') {
        return jsonResponse(await openDirectory(ctx, data.target, request.signal))
      }

      return jsonResponse(
        await queue.run(() => applyBatch(ctx, ctx.sessions, data.action, data.targets)),
      )
    },
  })
}
