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

function directoryOf(location?: SessionLocation) {
  return location?.kind === 'jsonl' ? dirname(location.path) : undefined
}

export async function listSessions(
  ctx: Context,
  sessions: SessionStore,
  signal: AbortSignal,
): Promise<SessionRow[]> {
  // 原生存储清单同时给出标题元信息和实际日志位置，未落盘会话没有存档目录。
  const stored = await ctx.sessionPersistence.list({ signal })
  const locations = new Map(stored.map((item) => [item.header.id, item]))
  const headers = new Map(stored.map((item) => [item.header.id, item.header]))
  for (const live of sessions.list()) headers.set(live.id, live.header)

  const titles = new Map<SessionId, string>()
  const missing: SessionId[] = []
  const keys = new Set(['title'] as const)
  const cache = ctx.get('sessionProjectionCache')
  for (const header of headers.values()) {
    const live = sessions.get(header.id)
    const projection = live
      ? ctx.sessionProjections.snapshot(live, keys)
      : (cache?.cachedSnapshot(header, keys) ?? cache?.cachedPredecessorTitle(header))
    const title = projection?.values.title
    if (title) titles.set(header.id, title)
    else if (title === undefined) missing.push(header.id)
  }
  if (missing.length) {
    for (const row of await ctx.sessionQuery.readTitleSnapshots(missing, signal)) {
      if (row.status === 'fulfilled' && row.value.title)
        titles.set(row.sessionId, row.value.title.title)
    }
  }

  const workspaces = ctx.workspaceRegistry.list()
  const bySession = new Map(workspaces.flatMap((w) => w.sessionIds.map((id) => [id, w] as const)))
  const byPath = new Map(workspaces.map((w) => [w.path, w]))
  const order = new Map<string, number>(workspaces.map((w, index) => [w.id, index]))
  const archived = new Set(ctx.workspaceRegistry.archivedSessionIds)
  const desktopAvailable = ctx.get('sessionController')?.canOpenWorkspacePath?.() ?? false
  const rows: SessionRow[] = Array.from(headers.values(), (header) => {
    const { id, cwd, createdAt } = header
    const w = bySession.get(id) ?? (cwd ? byPath.get(cwd) : undefined)
    const stored = locations.get(id)
    const directory =
      stored?.header.createdAt === createdAt ? directoryOf(stored.location) : undefined
    return {
      id,
      createdAt,
      cwd,
      title: titles.get(id) ?? '未命名会话',
      workspace: w
        ? { key: w.id, title: w.title }
        : { key: 'cwd:' + (cwd ?? ''), title: cwd ? basename(cwd) || cwd : '未分组' },
      directory,
      canOpenDirectory: desktopAvailable && !!directory,
      live: !!sessions.get(id),
      archived: archived.has(id),
    }
  })
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
  const id = target.id as SessionId
  const stored = await ctx.sessionPersistence.stat(id, { signal })
  if (stored?.header.createdAt !== target.createdAt)
    throw new Error('会话存档已变更或暂无存档，请刷新列表')
  const path = directoryOf(stored.location)
  if (!path || !isAbsolute(path) || !(await stat(path, { throwIfNoEntry: false }))?.isDirectory())
    throw new Error('目录不存在或尚未落盘')
  return controller.openWorkspacePath({ path }, signal)
}
