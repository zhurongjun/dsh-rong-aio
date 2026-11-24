import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import { refreshSearchIndex, removeSession } from '../../../host/remove-session.ts'
import { createSpillScanCache, type SpillScanCache } from '../../../host/session-spill.ts'
import { errorMessage } from '../../../shared/error.ts'
import type {} from '../../../shared/session-events.ts'
import type { Action, BatchResult, Outcome, Target } from '../shared/protocol.ts'
import { collectSessionLineage, type SessionLineage } from './lineage.ts'

async function validateDeleteTree(
  ctx: Context,
  sessions: SessionStore,
  target: Target,
  lineage: SessionLineage,
): Promise<{ rootExists: boolean; descendants: Target[] }> {
  const id = target.id as SessionId
  const claimed = ctx.bail('rong-aio/session-claim', id)
  if (claimed) throw new Error(claimed)

  const live = sessions.get(id)
  const stored = await ctx.sessionPersistence.stat(id)
  const header = live?.header ?? stored?.header
  if (header?.origin === 'subagent') {
    throw new Error('子会话不支持单独删除，请删除所属主会话')
  }
  if (header) {
    if (live) throw new Error('会话仍被 DSH 占用；请在释放会话或重启 DSH 后重试')
    if (stored?.header.id !== id || stored.header.createdAt !== target.createdAt) {
      throw new Error('会话已变更或已移除，请刷新列表')
    }

    const activity = await ctx.waterfall(
      'workspace/session-activity',
      { sessionId: id },
      async () => [],
    )
    if (activity.length) throw new Error('会话有正在进行的任务，请在任务结束后重试')
  } else {
    const missing = lineage.missingRoots.get(id)
    if (!missing || missing.createdAt !== target.createdAt) {
      throw new Error('会话已变更或已移除，请刷新列表')
    }
  }

  const descendants: Target[] = []
  for (const descId of lineage.collectDescendantsPostOrder(id)) {
    const descClaimed = ctx.bail('rong-aio/session-claim', descId)
    if (descClaimed) throw new Error(descClaimed)
    if (sessions.get(descId)) {
      throw new Error('子会话仍被 DSH 占用；请在释放会话或重启 DSH 后重试')
    }

    const descStored = await ctx.sessionPersistence.stat(descId)
    if (!descStored) continue

    const descActivity = await ctx.waterfall(
      'workspace/session-activity',
      { sessionId: descId },
      async () => [],
    )
    if (descActivity.length) {
      throw new Error('子会话有正在进行的任务，请在任务结束后重试')
    }
    descendants.push({ id: descId, createdAt: descStored.header.createdAt })
  }

  if (!header && !descendants.length) {
    throw new Error('会话已变更或已移除，请刷新列表')
  }

  return { rootExists: Boolean(header), descendants }
}

async function deletableBatchIds(
  ctx: Context,
  sessions: SessionStore,
  targets: readonly Target[],
  lineage: SessionLineage,
): Promise<ReadonlySet<string>> {
  const excluding = new Set<string>()

  for (const item of targets) {
    try {
      const { rootExists, descendants } = await validateDeleteTree(ctx, sessions, item, lineage)
      if (rootExists) excluding.add(item.id)
      for (const descendant of descendants) excluding.add(descendant.id)
    } catch {}
  }

  return excluding.size <= 1 ? new Set<string>() : excluding
}

async function clearMissingRootState(ctx: Context, id: SessionId): Promise<void> {
  await ctx.parallel('rong-aio/session-removing', id)
  await ctx.storageDomain.get('session_projcache')?.table('sessions').delete(id)
  for (const workspace of ctx.workspaceRegistry.list()) {
    if (workspace.sessionIds.includes(id)) await workspace.detachSession(id)
  }
  await ctx.workspaceRegistry.unpinSession(id)
  await ctx.workspaceRegistry.unarchiveSession(id)
}

async function applyAction(
  ctx: Context,
  sessions: SessionStore,
  action: Action,
  target: Target,
  lineage: SessionLineage,
  spillCache?: SpillScanCache,
) {
  const id = target.id as SessionId
  if (action === 'delete') {
    const { rootExists, descendants } = await validateDeleteTree(ctx, sessions, target, lineage)
    for (const descendant of descendants) {
      await removeSession(ctx, descendant.id as SessionId, descendant, spillCache)
    }
    if (rootExists) return removeSession(ctx, id, target, spillCache)
    return clearMissingRootState(ctx, id)
  }

  const claimed = ctx.bail('rong-aio/session-claim', id)
  if (claimed) throw new Error(claimed)

  const live = sessions.get(id)
  const header = live?.header ?? (await ctx.sessionPersistence.stat(id))?.header
  if (header?.origin === 'subagent') throw new Error('子会话跟随所属主会话归档或复原')

  if (header) {
    if (header.createdAt !== target.createdAt) throw new Error('会话已变更或已移除，请刷新列表')
    if (action === 'archive') {
      await ctx.workspaceRegistry.archiveSession(id)
      return
    }
    await ctx.workspaceRegistry.unarchiveSession(id)
    const archivedIds = new Set(ctx.workspaceRegistry.archivedSessionIds)
    for (const descId of lineage.collectDescendantsPostOrder(id)) {
      if (archivedIds.has(descId)) await ctx.workspaceRegistry.unarchiveSession(descId)
    }
    return
  }

  const missing = lineage.missingRoots.get(id)
  if (!missing || missing.createdAt !== target.createdAt) {
    throw new Error('会话已变更或已移除，请刷新列表')
  }

  if (action === 'archive') {
    const persistedDesc = lineage
      .collectDescendantsPostOrder(id)
      .filter((descId) => lineage.locations.has(descId))
    if (!persistedDesc.length) throw new Error('会话已变更或已移除，请刷新列表')
    for (const descId of persistedDesc) {
      const descClaimed = ctx.bail('rong-aio/session-claim', descId)
      if (descClaimed) throw new Error(descClaimed)
      const activity = await ctx.waterfall(
        'workspace/session-activity',
        { sessionId: descId },
        async () => [],
      )
      if (activity.length) throw new Error('子会话有正在进行的任务，请在任务结束后重试')
    }
    for (const descId of persistedDesc) {
      await ctx.workspaceRegistry.archiveSession(descId)
    }
    return
  }

  const archivedIds = new Set(ctx.workspaceRegistry.archivedSessionIds)
  if (archivedIds.has(id)) await ctx.workspaceRegistry.unarchiveSession(id)
  for (const descId of lineage.collectDescendantsPostOrder(id)) {
    if (archivedIds.has(descId)) await ctx.workspaceRegistry.unarchiveSession(descId)
  }
}

export async function applyBatch(
  ctx: Context,
  sessions: SessionStore,
  action: Action,
  targets: Target[],
): Promise<BatchResult> {
  const unique = [...new Map(targets.map((item) => [item.id, item])).values()]
  const lineage = await collectSessionLineage(ctx, sessions)
  const spillCache =
    action === 'delete'
      ? createSpillScanCache(await deletableBatchIds(ctx, sessions, unique, lineage))
      : undefined

  const outcomes: Outcome[] = []
  for (const target of unique) {
    try {
      await applyAction(ctx, sessions, action, target, lineage, spillCache)
      outcomes.push({ id: target.id })
    } catch (error) {
      outcomes.push({ id: target.id, error: errorMessage(error) })
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
