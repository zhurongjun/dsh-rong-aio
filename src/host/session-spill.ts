import { lstat, readdir, readFile, realpath, rm, rmdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import { findActiveEntry } from './dsh-adapter.ts'

/** 本地后端的公开导出，同时兼容未安装该可选后端的宿主。 */
interface LocalSpills {
  sessionDir(root: string, id: string): string
  discoverDefaultRoots(warn: (message: string) => void): Promise<string[]>
  privateRoot(): string
}

/** 批量删除共享的会话引用扫描缓存，避免每个被删会话重复读取存活会话日志。 */
export interface SpillScanCache {
  texts: Map<SessionId, string>
  excludingIds?: ReadonlySet<string>
}

export function createSpillScanCache(excludingIds?: ReadonlySet<string>): SpillScanCache {
  return { texts: new Map(), excludingIds }
}

/** 读取未在内存中打开的冷 JSONL 原文以跳过事件反序列化，无法确认时回退到 sessionQuery。 */
async function readSessionCorpusText(ctx: Context, id: SessionId): Promise<string> {
  const live = ctx.get('sessions')?.get(id)
  if (!live) {
    const stored = await ctx.sessionPersistence.stat(id)
    if (stored?.location?.kind === 'jsonl' && !stored.location.path.endsWith('.zstd')) {
      return readFile(stored.location.path, 'utf8')
    }
  }
  const other = await ctx.sessionQuery.readSession(id)
  return JSON.stringify(other.events)
}

export async function removeSpills(ctx: Context, handle: SessionHandle, cache?: SpillScanCache) {
  const entry = findActiveEntry(ctx, '@deepseek-ai/dsh-spill-local')
  const backend = entry?.moduleNamespace as LocalSpills | undefined
  if (!backend) return
  const config = entry?.fiber?.effectiveConfig as { root?: string } | undefined
  const activeRoot = config?.root === undefined ? backend.privateRoot() : resolve(config.root)
  const roots = await backend.discoverDefaultRoots((message) => ctx.logger.warn(message))
  const candidates = new Map<string, string>()
  let ownEvents: string | undefined
  for (const root of new Set([activeRoot, ...roots])) {
    const dir = backend.sessionDir(root, handle.id)
    if (relative(root, dirname(dir)) !== '') throw new Error('无法确认会话工具输出目录')
    const info = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    if (!info || !info.isDirectory() || info.isSymbolicLink()) continue
    const directory = await realpath(dir)
    if (relative(await realpath(root), dirname(directory)) !== '')
      throw new Error('工具输出目录指向其他位置')
    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (!file.isFile() || !/^[0-9a-f]{12}-/.test(file.name)) continue
      const path = join(directory, file.name)
      // 历史临时根可能属于另一个 profile，要求本会话日志中存在对应输出记录。
      if (root !== activeRoot) {
        ownEvents ??= JSON.stringify((await handle.read()).events)
        if (!ownEvents.includes(file.name)) continue
      }
      candidates.set(path, file.name)
    }
  }
  if (!candidates.size) return
  // Fork 会复制工具结果，包括原始输出文件名；保留仍由其他会话引用的输出。
  for (const { header } of await ctx.sessionQuery.listSessions()) {
    if (header.id === handle.id || cache?.excludingIds?.has(header.id)) continue
    try {
      let text = cache?.texts.get(header.id)
      if (text === undefined) {
        text = await readSessionCorpusText(ctx, header.id)
        cache?.texts.set(header.id, text)
      }
      for (const [path, name] of candidates) {
        const escaped = JSON.stringify(name).slice(1, -1)
        if (text.includes(name) || (escaped !== name && text.includes(escaped)))
          candidates.delete(path)
      }
      if (!candidates.size) return
    } catch {
      // 无法排除共享引用时交给 DSH 自己的保留期清理。
      return
    }
  }
  const directories = new Set<string>()
  for (const path of candidates.keys()) {
    await rm(path, { force: true })
    directories.add(dirname(path))
  }
  for (const dir of directories) {
    await rmdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST')
        throw error
    })
  }
}
