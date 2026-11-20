import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type { Action, BatchResult, Outcome, Target } from '../shared/protocol.ts'
import { refreshSearchIndex, removeSession } from './remove.ts'

async function applyAction(ctx: Context, sessions: SessionStore, action: Action, target: Target) {
  const id = target.id as SessionId
  const live = sessions.get(id)
  if (action === 'delete') {
    if (live) throw new Error('会话仍被 DSH 占用；请在释放会话或重启 DSH 后重试')
    return removeSession(ctx, id, target)
  }
  const header = live?.header ?? (await ctx.sessionPersistence.stat(id))?.header
  if (header?.createdAt !== target.createdAt) throw new Error('会话已变更或已移除，请刷新列表')
  if (action === 'archive') await ctx.workspaceRegistry.archiveSession(id)
  else await ctx.workspaceRegistry.unarchiveSession(id)
}

export async function applyBatch(
  ctx: Context,
  sessions: SessionStore,
  action: Action,
  targets: Target[],
): Promise<BatchResult> {
  const outcomes: Outcome[] = []
  for (const target of new Map(targets.map((item) => [item.id, item])).values()) {
    try {
      await applyAction(ctx, sessions, action, target)
      outcomes.push({ id: target.id })
    } catch (error) {
      outcomes.push({
        id: target.id,
        error: error instanceof Error ? error.message : String(error),
      })
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
}
