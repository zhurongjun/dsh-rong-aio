import { lstat, readdir, realpath, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '../shared/session-events.ts'
import { sessionDirectory, sessionRoot } from './session-location.ts'
import { removeSpills } from './session-spill.ts'

interface Target {
  id: string
  createdAt: number
}

/** 已存在的原生全文索引在公开搜索接口执行查询前，会先清理消失的会话记录。 */
export async function refreshSearchIndex(ctx: Context, removed: SessionId) {
  const backend = [...ctx.loader.entries()].find(
    (entry) =>
      entry.options.name === '@deepseek-ai/dsh-session-query-sqlite' &&
      !entry.disabled &&
      entry.fiber?.state === 2,
  )
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

/** 只接受当前 JSONL 后端给出的、确实位于此会话专属目录的物理日志。 */
async function locate(root: string, target: Target, stored?: SessionPersistenceSnapshot) {
  if (stored?.header.id !== target.id || stored.header.createdAt !== target.createdAt)
    throw new Error('会话已变更或已移除，请刷新列表')
  const location = stored.location
  const directory = sessionDirectory(root, stored.header)
  if (
    location?.kind !== 'jsonl' ||
    relative(directory, dirname(location.path)) !== '' ||
    !/^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/.test(basename(location.path))
  )
    throw new Error('无法确认此会话的独立日志目录')
  const physical = join(await realpath(root), relative(root, location.path))
  if (relative(physical, await realpath(location.path)) !== '' || !(await lstat(physical)).isFile())
    throw new Error('会话目录或日志指向其他位置，已停止删除')
  return physical
}

export async function removeSession(ctx: Context, id: SessionId, target: Target) {
  const persistence = ctx.sessionPersistence
  const root = sessionRoot(ctx)
  await locate(root, target, await persistence.stat(id))
  const activity = await ctx.waterfall(
    'workspace/session-activity',
    { sessionId: id },
    async () => [],
  )
  if (activity.length) throw new Error('会话有正在进行的任务，请在任务结束后重试')
  // 公开写句柄同时排除本进程与其他 DSH 实例的写入者。
  const handle = await persistence.open(id, 'write').catch((error: unknown) => {
    if (error instanceof Error && error.name === 'SessionAlreadyOwnedError')
      throw new Error('会话的写入仍被 DSH 占用，请在释放后重试')
    throw error
  })
  try {
    // 打开历史版本可能触发原生迁移，重新获取当前代并核验身份。
    const log = await locate(root, target, await persistence.stat(id))
    const directory = dirname(log)
    await removeSpills(ctx, handle)
    await ctx.parallel('rong-aio/session-removing', id)
    await ctx.storageDomain.get('session_projcache')?.table('sessions').delete(id)
    for (const workspace of ctx.workspaceRegistry.list()) {
      if (workspace.sessionIds.includes(id)) await workspace.detachSession(id)
    }
    await ctx.workspaceRegistry.unpinSession(id)
    await ctx.workspaceRegistry.unarchiveSession(id)

    // 先清伴随文件和旧代；清理失败时当前日志仍可以定位并重试。
    for (const name of await readdir(directory)) {
      if (name !== basename(log) && name !== 'session.lock')
        await rm(join(directory, name), { recursive: true, force: true })
    }
    await unlink(log)
    // 冷会话没有 session/disposed 生命周期。主日志消失后同步所有已连接的原生会话列表。
    ctx.emit('api-session/removed', id)
    await rm(join(directory, 'session.lock'), { force: true })
    await rmdir(directory)
  } finally {
    await handle.close()
  }
}
