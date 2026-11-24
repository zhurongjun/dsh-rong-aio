import { lstat, readdir, readFile, realpath, rm, rmdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import { findActiveEntry } from './dsh-adapter.ts'

interface LocalSpills {
  sessionDir(root: string, id: string): string
  discoverDefaultRoots(warn: (message: string) => void): Promise<string[]>
  privateRoot(): string
}

export interface SpillScanCache {
  texts: Map<SessionId, string>
  excludingIds?: ReadonlySet<string>
}

export function createSpillScanCache(excludingIds?: ReadonlySet<string>): SpillScanCache {
  return { texts: new Map(), excludingIds }
}

async function readSessionCorpusText(ctx: Context, id: SessionId): Promise<string> {
  if (!ctx.get('sessions')?.get(id)) {
    const stored = await ctx.sessionPersistence.stat(id)
    if (stored?.location?.kind === 'jsonl' && !stored.location.path.endsWith('.zstd')) {
      return readFile(stored.location.path, 'utf8')
    }
  }
  const other = await ctx.sessionQuery.readSession(id)
  return JSON.stringify(other.events)
}

async function collectSpillCandidates(
  ctx: Context,
  handle: SessionHandle,
  backend: LocalSpills,
  activeRoot: string,
): Promise<Map<string, string>> {
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
    if (relative(await realpath(root), dirname(directory)) !== '') {
      throw new Error('工具输出目录指向其他位置')
    }

    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (!file.isFile() || !/^[0-9a-f]{12}-/.test(file.name)) continue
      if (root !== activeRoot) {
        ownEvents ??= JSON.stringify((await handle.read()).events)
        if (!ownEvents.includes(file.name)) continue
      }
      candidates.set(join(directory, file.name), file.name)
    }
  }

  return candidates
}

async function pruneReferencedSpills(
  ctx: Context,
  candidates: Map<string, string>,
  ownId: SessionId,
  cache?: SpillScanCache,
): Promise<boolean> {
  for (const { header } of await ctx.sessionQuery.listSessions()) {
    if (header.id === ownId || cache?.excludingIds?.has(header.id)) continue
    try {
      let text = cache?.texts.get(header.id)
      if (text === undefined) {
        text = await readSessionCorpusText(ctx, header.id)
        cache?.texts.set(header.id, text)
      }
      for (const [path, name] of candidates) {
        const escaped = JSON.stringify(name).slice(1, -1)
        if (text.includes(name) || (escaped !== name && text.includes(escaped))) {
          candidates.delete(path)
        }
      }
      if (!candidates.size) return false
    } catch {
      return false
    }
  }
  return candidates.size > 0
}

export async function removeSpills(ctx: Context, handle: SessionHandle, cache?: SpillScanCache) {
  const entry = findActiveEntry(ctx, '@deepseek-ai/dsh-spill-local')
  const backend = entry?.moduleNamespace as LocalSpills | undefined
  if (!backend) return

  const config = entry?.fiber?.effectiveConfig as { root?: string } | undefined
  const activeRoot = config?.root === undefined ? backend.privateRoot() : resolve(config.root)
  const candidates = await collectSpillCandidates(ctx, handle, backend, activeRoot)
  if (!candidates.size) return
  if (!(await pruneReferencedSpills(ctx, candidates, handle.id, cache))) return

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
