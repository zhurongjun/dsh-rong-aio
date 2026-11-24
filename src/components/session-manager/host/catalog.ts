import { stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionLocation } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SessionRow, Target } from '../shared/protocol.ts'
import { collectSessionLineage } from './lineage.ts'

function directoryOf(location?: SessionLocation) {
  return location?.kind === 'jsonl' ? dirname(location.path) : undefined
}

export async function listSessions(
  ctx: Context,
  sessions: SessionStore,
  signal: AbortSignal,
): Promise<SessionRow[]> {
  const lineage = await collectSessionLineage(ctx, sessions, signal)
  const { headers, locations } = lineage

  const titles = new Map<SessionId, string>()
  const missingTitles: SessionId[] = []
  const keys = new Set(['title'] as const)
  const cache = ctx.get('sessionProjectionCache')
  for (const header of headers.values()) {
    const live = sessions.get(header.id)
    const projection = live
      ? ctx.sessionProjections.snapshot(live, keys)
      : (cache?.cachedSnapshot(header, keys) ?? cache?.cachedPredecessorTitle(header))
    const title = projection?.values.title
    if (title) titles.set(header.id, title)
    else if (title === undefined) missingTitles.push(header.id)
  }

  if (missingTitles.length) {
    for (const row of await ctx.sessionQuery.readTitleSnapshots(missingTitles, signal)) {
      if (row.status === 'fulfilled' && row.value.title) {
        titles.set(row.sessionId, row.value.title.title)
      }
    }
  }

  const workspaces = ctx.workspaceRegistry.list()
  const bySession = new Map(workspaces.flatMap((w) => w.sessionIds.map((id) => [id, w] as const)))
  const byPath = new Map(workspaces.map((w) => [w.path, w]))
  const order = new Map<string, number>(workspaces.map((w, index) => [w.id, index]))
  const archivedSet = new Set(ctx.workspaceRegistry.archivedSessionIds)
  const desktopAvailable = ctx.get('sessionController')?.canOpenWorkspacePath?.() ?? false

  const resolveWorkspace = (id: SessionId, cwd?: string) => {
    const matched = bySession.get(id) ?? (cwd ? byPath.get(cwd) : undefined)
    return matched
      ? { key: matched.id, title: matched.title }
      : {
          key: 'cwd:' + (cwd ?? ''),
          title: cwd ? basename(cwd) || cwd : '未分组',
        }
  }

  const rootMeta = new Map<
    SessionId,
    { workspace: { key: string; title: string }; archived: boolean }
  >()
  for (const header of headers.values()) {
    if (header.origin === 'subagent') continue
    rootMeta.set(header.id, {
      workspace: resolveWorkspace(header.id, header.cwd),
      archived: archivedSet.has(header.id),
    })
  }
  for (const [rootId, info] of lineage.missingRoots) {
    const persistedDesc = lineage
      .collectDescendantsPostOrder(rootId)
      .filter((descId) => locations.has(descId))
    rootMeta.set(rootId, {
      workspace: resolveWorkspace(rootId, info.cwd),
      archived:
        archivedSet.has(rootId) ||
        (persistedDesc.length > 0 && persistedDesc.every((descId) => archivedSet.has(descId))),
    })
  }

  const rows: SessionRow[] = Array.from(headers.values(), (header) => {
    const { id, cwd, createdAt } = header
    const subagent = header.origin === 'subagent'
    const parentId = subagent ? lineage.parentOf.get(id) : undefined
    const rootId = lineage.resolveRootId(id)
    const meta = rootMeta.get(rootId) ?? {
      workspace: resolveWorkspace(id, cwd),
      archived: archivedSet.has(id),
    }
    const entry = locations.get(id)
    const directory =
      entry?.header.createdAt === createdAt ? directoryOf(entry.location) : undefined

    return {
      id,
      createdAt,
      cwd,
      title: titles.get(id) ?? '未命名会话',
      workspace: meta.workspace,
      directory,
      canOpenDirectory: desktopAvailable && !!directory,
      live: !!sessions.get(id),
      archived: meta.archived,
      subagent,
      ...(parentId !== undefined ? { parentId } : {}),
    }
  })

  for (const [rootId, info] of lineage.missingRoots) {
    const meta = rootMeta.get(rootId)!
    rows.push({
      id: rootId,
      createdAt: info.createdAt,
      ...(info.cwd !== undefined ? { cwd: info.cwd } : {}),
      title: '主会话已缺失',
      workspace: meta.workspace,
      canOpenDirectory: false,
      live: false,
      archived: meta.archived,
      subagent: false,
      missing: true,
    })
  }

  rows.sort(
    (a, b) =>
      (order.get(a.workspace.key) ?? workspaces.length) -
        (order.get(b.workspace.key) ?? workspaces.length) ||
      b.createdAt - a.createdAt ||
      a.id.localeCompare(b.id),
  )
  return rows
}

export async function openDirectory(ctx: Context, target: Target, signal: AbortSignal) {
  const controller = ctx.get('sessionController')
  if (!controller?.canOpenWorkspacePath?.()) throw new Error('此 DSH 宿主无法打开文件管理器')

  const stored = await ctx.sessionPersistence.stat(target.id as SessionId, { signal })
  if (stored?.header.createdAt !== target.createdAt)
    throw new Error('会话存档已变更或暂无存档，请刷新列表')

  const path = directoryOf(stored.location)
  if (!path || !isAbsolute(path) || !(await stat(path, { throwIfNoEntry: false }))?.isDirectory())
    throw new Error('目录不存在或尚未落盘')

  return controller.openWorkspacePath({ path }, signal)
}
