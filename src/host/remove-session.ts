import { lstat, readdir, realpath, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '../shared/session-events.ts'
import { findActiveEntry } from './dsh-adapter.ts'
import { sessionDirectory, sessionRoot } from './session-location.ts'
import { removeSpills, type SpillScanCache } from './session-spill.ts'

interface Target {
  id: string
  createdAt: number
}

export async function refreshSearchIndex(ctx: Context, removed: SessionId) {
  const backend = findActiveEntry(ctx, '@deepseek-ai/dsh-session-query-sqlite')
  const config = backend?.fiber?.effectiveConfig as { path?: string; openAt?: string } | undefined
  if (!config?.path || config.path === ':memory:') return

  const index = await stat(config.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (!index?.isFile()) return
  if (config.openAt === 'never') throw new Error('全文搜索已停用，启用并搜索一次后将同步索引')

  await ctx.sessionQuery.searchSessions({
    query: 'session',
    sessionFilters: [{ kind: 'id', values: [removed] }],
    limit: 1,
  })
}

async function locate(root: string, target: Target, stored?: SessionPersistenceSnapshot) {
  if (stored?.header.id !== target.id || stored.header.createdAt !== target.createdAt)
    throw new Error('会话已变更或已移除，请刷新列表')

  const location = stored.location
  const directory = sessionDirectory(root, stored.header)
  if (
    location?.kind !== 'jsonl' ||
    relative(directory, dirname(location.path)) !== '' ||
    !/^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/.test(basename(location.path))
  ) {
    throw new Error('无法确认此会话的独立日志目录')
  }

  const physical = join(await realpath(root), relative(root, location.path))
  if (relative(physical, await realpath(location.path)) !== '' || !(await lstat(physical)).isFile())
    throw new Error('会话目录或日志指向其他位置，已停止删除')

  return physical
}

export async function removeSession(
  ctx: Context,
  id: SessionId,
  target: Target,
  spillCache?: SpillScanCache,
) {
  const persistence = ctx.sessionPersistence
  const root = sessionRoot(ctx)
  await locate(root, target, await persistence.stat(id))

  const activity = await ctx.waterfall(
    'workspace/session-activity',
    { sessionId: id },
    async () => [],
  )
  if (activity.length) throw new Error('会话有正在进行的任务，请在任务结束后重试')

  const handle = await persistence.open(id, 'write').catch((error: unknown) => {
    if (error instanceof Error && error.name === 'SessionAlreadyOwnedError')
      throw new Error('会话的写入仍被 DSH 占用，请在释放后重试')
    throw error
  })

  try {
    const log = await locate(root, target, await persistence.stat(id))
    const directory = dirname(log)

    await removeSpills(ctx, handle, spillCache)
    await ctx.parallel('rong-aio/session-removing', id)
    await ctx.storageDomain.get('session_projcache')?.table('sessions').delete(id)

    for (const workspace of ctx.workspaceRegistry.list()) {
      if (workspace.sessionIds.includes(id)) await workspace.detachSession(id)
    }
    await ctx.workspaceRegistry.unpinSession(id)
    await ctx.workspaceRegistry.unarchiveSession(id)

    for (const name of await readdir(directory)) {
      if (name !== basename(log) && name !== 'session.lock')
        await rm(join(directory, name), { recursive: true, force: true })
    }
    await unlink(log)

    ctx.emit('api-session/removed', id)
    await rm(join(directory, 'session.lock'), { force: true })
    await rmdir(directory)
  } finally {
    await handle.close()
  }
}
