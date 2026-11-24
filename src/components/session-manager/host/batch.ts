import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type { Action, BatchResult, Outcome, Target } from '../shared/protocol.ts'
import type {} from '../../../shared/session-events.ts'
import { errorMessage } from '../../../shared/error.ts'
import { refreshSearchIndex, removeSession } from '../../../host/remove-session.ts'
import { createSpillScanCache, type SpillScanCache } from '../../../host/session-spill.ts'

async function applyAction(
  ctx: Context,
  sessions: SessionStore,
  action: Action,
  target: Target,
  spillCache?: SpillScanCache,
) {
  const id = target.id as SessionId
  const claimed = ctx.bail('rong-aio/session-claim', id)
  if (claimed) throw new Error(claimed)
  const live = sessions.get(id)
  if (action === 'delete') {
    if (live) throw new Error('会话仍被 DSH 占用；请在释放会话或重启 DSH 后重试')
    return removeSession(ctx, id, target, spillCache)
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
  const unique = [...new Map(targets.map((item) => [item.id, item])).values()]
  let spillCache: SpillScanCache | undefined
  if (action === 'delete') {
    const excluding = new Set<string>()
    if (unique.length > 1) {
      for (const item of unique) {
        const id = item.id as SessionId
        if (ctx.bail('rong-aio/session-claim', id) || sessions.get(id)) continue
        const stored = await ctx.sessionPersistence.stat(id)
        if (stored?.header.createdAt !== item.createdAt) continue
        const activity = await ctx.waterfall(
          'workspace/session-activity',
          { sessionId: id },
          async () => [],
        )
        if (!activity.length) excluding.add(id)
      }
    }
    spillCache = createSpillScanCache(excluding)
  }

  const outcomes: Outcome[] = []
  for (const target of unique) {
    try {
      await applyAction(ctx, sessions, action, target, spillCache)
      outcomes.push({ id: target.id })
    } catch (error) {
      outcomes.push({
        id: target.id,
        error: errorMessage(error),
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
        warning: '磁盘删除已完成，全文索引待同步。' + errorMessage(error),
      }
    }
  }
  return { outcomes }
}
