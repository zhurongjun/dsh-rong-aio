import type { Context } from '@deepseek-ai/cordis'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as z from 'zod'
import type {} from '../../../shared/session-events.ts'
import { jsonResponse, parseJsonBody, registerJsonEndpoint } from '../../../host/http.ts'
import { errorMessage } from '../../../shared/error.ts'
import { createSerialQueue } from '../../../shared/serial-queue.ts'
import { removeSession, refreshSearchIndex } from '../../../host/remove-session.ts'
import { commandSchema, permissionSchema, type SideCommand } from '../shared/commands.ts'
import { sideAgents } from './agents.ts'
import {
  API,
  isSideSession,
  sideSessionId,
  sideTitle,
  type SideDraftInfo,
  type SideHistory,
} from '../shared/protocol.ts'
import { restoreLegacyContext } from './context.ts'
import { installSideInstructions } from './instructions.ts'
import { installPermissions } from './permissions.ts'
import { forkPrefix, prefixSchema, protectPrefix } from './prefix.ts'

export const inject = [
  'connection',
  'agents',
  'llm',
  'agentDefaultModel',
  'sessionController',
  'sessionPersistence',
  'sessions',
  'storageDomain',
  'permissionPresets',
  'approval',
  'sandboxPolicy',
  'tools',
  'commands',
  'workspaceRegistry',
  'sessionQuery',
  'loader',
]
const rowSchema = z.object({
  parent: z.string(),
  title: z.string(),
  forkedAt: z.number(),
  updatedAt: z.number(),
  permission: permissionSchema,
  firstAccepted: z.boolean().optional(),
  tabKey: z.string().optional(),
  prefix: prefixSchema.optional(),
})
export async function apply(ctx: Context) {
  const sessions = ctx.sessions
  const domain = await ctx.storageDomain.open({
    name: 'rong_aio_side',
    version: 1,
    tables: { chats: { valueSchema: rowSchema } },
  })
  const chats = domain.table('chats')
  const agents = sideAgents(ctx, (id) => chats.get(id)?.permission)
  const sync = installPermissions(ctx, (id) => chats.get(id))
  restoreLegacyContext(ctx)
  installSideInstructions(ctx, (id) => chats.get(id)?.parent)
  protectPrefix(
    ctx,
    sessions,
    (id) => chats.get(id)?.prefix,
    (id, prefix) => chats.update(id, (row) => ({ ...row, prefix })),
  )
  const approvals = new Map<string, Set<string>>()
  const queue = createSerialQueue('侧聊组件已停用')
  ctx.effect(() => async () => {
    try {
      await queue.close()
      await agents.dispose()
    } finally {
      await domain.close()
    }
  })
  ctx.on('rong-aio/session-claim', (id) =>
    isSideSession(id) ? '请在所属主会话的侧聊历史中管理这条记录' : undefined,
  )
  async function resolveParent(id: string) {
    if (!id || isSideSession(id)) throw new Error('请从主会话进入侧聊')
    const result = await ctx.sessionController.resolveAgent(id as SessionId)
    if (!('agent' in result) || !result.agent || result.agent.session.header.origin === 'subagent')
      throw new Error('无法打开所属的主会话')
    return result.agent
  }
  async function draft(source: string): Promise<SideDraftInfo> {
    const seen = new Set<string>()
    let id: string | undefined = source
    while (id && !seen.has(id)) {
      seen.add(id)
      if (isSideSession(id)) {
        id = chats.get(id)?.parent
        continue
      }
      using cut = await ctx.sessionQuery.observeSession(id as SessionId, { projectionMode: 'none' })
      if (cut.header.origin === 'subagent') {
        id = cut.header.parentSession
        continue
      }
      const fork = { parent: id, createdAt: cut.header.createdAt }
      return { fork, ...history(id) }
    }
    throw new Error('找不到当前对话所属的主会话')
  }
  function assertOwned(parent: string, id: string) {
    const row = chats.get(id)
    if (!row || row.parent !== parent) throw new Error('该侧聊不属于当前会话')
  }
  function history(parent: string): SideHistory {
    const agent = ctx.agents.get(parent as SessionId)
    return {
      rows: [...chats.entries()]
        .filter(([, r]) => r.parent === parent)
        .map(([id, { parent, title, forkedAt, updatedAt, permission, tabKey }]) => ({
          id,
          tabKey,
          parent,
          title,
          forkedAt,
          updatedAt,
          permission,
          pending: !!approvals.get(id)?.size,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      parentPermission: agent ? ctx.permissionPresets.current(agent.session) : '',
    }
  }
  async function sendFirst(cmd: Extract<SideCommand, { action: 'create' }>, signal: AbortSignal) {
    // Observe on receipt, before a queued operation or agent resolution advances the parent.
    const at = Date.now()
    using cut = await ctx.sessionQuery.observeSession(cmd.parent as SessionId, {
      projectionMode: 'none',
    })
    if (cut.header.createdAt !== cmd.createdAt) throw new Error('主会话已更换，请重新打开侧聊')
    return await queue.run(async () => {
      const parent = await resolveParent(cmd.parent)
      const id = sideSessionId(cmd.key) as SessionId
      const row = chats.get(id)
      if (row && row.parent !== parent.id) throw new Error('该侧聊不属于当前会话')
      if (row?.firstAccepted) return { id }
      const agent = row ? await agents.open(id) : await agents.fork(parent, id, cut)
      if (!row) {
        try {
          await sessions.flush(agent.session)
          const prefix = forkPrefix(agent.session)
          await chats.put(id, {
            parent: parent.id,
            title: '',
            forkedAt: at,
            updatedAt: at,
            permission: cmd.permission,
            tabKey: cmd.tabKey,
            ...(prefix && { prefix }),
          })
        } catch (error) {
          await agents.release(id)
          const stat = await ctx.sessionPersistence.stat(id)
          if (stat) await removeSession(ctx, id, { id, createdAt: stat.header.createdAt })
          throw error
        }
      }
      sync(agent.session)
      try {
        await ctx.sessionController.prompt(
          {
            sessionId: id,
            requestId: cmd.key as SessionRequestId,
            mode: 'queue',
            content: [{ type: 'text', text: cmd.text }],
          },
          signal,
        )
      } catch (error) {
        if (!row) await remove(parent.id, id)
        throw error
      }
      await sessions.flush(agent.session)
      await chats.update(id, (r) => ({ ...r, firstAccepted: true }))
      return { id }
    })
  }
  async function remove(parent: string, id: SessionId) {
    assertOwned(parent, id)
    const agent = ctx.agents.get(id)
    if (
      agent?.status === 'running' ||
      agent?.inbox.nextTurn.length ||
      agent?.inbox.nextStep.some((m) => m.source.kind !== 'rong-side-context') ||
      approvals.get(id)?.size
    )
      throw new Error('请先停止侧聊或清空排队消息，再删除记录')
    await agents.release(id, sessions)
    const stat = await ctx.sessionPersistence.stat(id)
    if (stat) await removeSession(ctx, id, { id, createdAt: stat.header.createdAt })
    await chats.delete(id)
    approvals.delete(id)
    if (stat) await refreshSearchIndex(ctx, id)
  }
  ctx.on('rong-aio/session-removing', async (parent) => {
    if (isSideSession(parent)) return
    await queue.run(async () => {
      for (const [id, row] of chats.entries())
        if (row.parent === parent) await remove(parent, id as SessionId)
    })
  })
  ctx.on('session/event', (s, e) => {
    if (!isSideSession(s.id) || !s.isOwnSeq(e.seq)) return
    if (e.type === 'approval/asked') {
      let set = approvals.get(s.id)
      if (!set) approvals.set(s.id, (set = new Set()))
      set.add(e.data.id)
    }
    if (e.type === 'approval/decided') approvals.get(s.id)?.delete(e.data.id)
    if (e.type === 'user/message' && e.data.source.kind === 'user') {
      const text = e.data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
      const title = sideTitle(text) || '附件问询'
      void queue
        .run(async () => {
          const row = chats.get(s.id)
          if (row)
            await chats.update(s.id, (r) => ({ ...r, title: r.title || title, updatedAt: e.time }))
        })
        .catch((error) => ctx.logger.warn(errorMessage(error)))
    }
  })
  registerJsonEndpoint(ctx, {
    path: API,
    errorStatus: 409,
    async fetch(request) {
      if (request.method === 'GET') {
        const parent = new URL(request.url).searchParams.get('parent')
        if (!parent || isSideSession(parent)) throw new Error('需要主会话')
        return jsonResponse(history(parent))
      }
      const cmd = await parseJsonBody(request, commandSchema, '侧聊参数无效')
      if (cmd.action === 'draft') return jsonResponse(await draft(cmd.parent))
      if (cmd.action === 'create') return jsonResponse(await sendFirst(cmd, request.signal))
      return jsonResponse(
        await queue.run(async () => {
          const parent = await resolveParent(cmd.parent)
          const id = cmd.id as SessionId
          if (cmd.action === 'delete') await remove(parent.id, id)
          else {
            assertOwned(parent.id, id)
            const agent = await agents.open(id)
            if (cmd.action === 'permission') {
              await chats.update(id, (row) => ({ ...row, permission: cmd.permission }))
            }
            sync(agent.session)
          }
          return { id }
        }),
      )
    },
  })
}
