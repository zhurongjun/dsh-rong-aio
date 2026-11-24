import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import type {} from '../../../shared/session-events.ts'

export interface MissingRootInfo {
  id: SessionId
  createdAt: number
  cwd?: string
}

export interface SessionLineage {
  headers: Map<SessionId, SessionHeader>
  locations: Map<SessionId, SessionPersistenceSnapshot>
  parentOf: Map<SessionId, SessionId>
  childrenByParent: Map<SessionId, SessionHeader[]>
  missingRoots: Map<SessionId, MissingRootInfo>
  resolveRootId: (id: SessionId) => SessionId
  collectDescendantsPostOrder: (rootId: SessionId) => SessionId[]
}

function createsCycle(
  childId: SessionId,
  parentId: SessionId,
  parentOf: ReadonlyMap<SessionId, SessionId>,
): boolean {
  let current: SessionId | undefined = parentId
  const seen = new Set<SessionId>([childId])
  while (current !== undefined) {
    if (seen.has(current)) return true
    seen.add(current)
    current = parentOf.get(current)
  }
  return false
}

export async function collectSessionLineage(
  ctx: Context,
  sessions: SessionStore,
  signal?: AbortSignal,
): Promise<SessionLineage> {
  const stored = await ctx.sessionPersistence.list(signal ? { signal } : undefined)
  const locations = new Map(stored.map((item) => [item.header.id, item]))
  const headers = new Map(stored.map((item) => [item.header.id, item.header]))
  for (const live of sessions.list()) headers.set(live.id, live.header)

  const claimed = new Set<SessionId>()
  for (const id of headers.keys()) {
    if (ctx.bail('rong-aio/session-claim', id)) {
      claimed.add(id)
      headers.delete(id)
      locations.delete(id)
    }
  }

  const subagentHeaders = [...headers.values()]
    .filter((header) => header.origin === 'subagent')
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

  const parentOf = new Map<SessionId, SessionId>()
  const childrenByParent = new Map<SessionId, SessionHeader[]>()

  for (const header of subagentHeaders) {
    const candidate = header.parentSession
    const parent =
      candidate &&
      !claimed.has(candidate) &&
      !ctx.bail('rong-aio/session-claim', candidate) &&
      !createsCycle(header.id, candidate, parentOf)
        ? candidate
        : (`missing-root:${header.id}` as SessionId)
    parentOf.set(header.id, parent)
    let children = childrenByParent.get(parent)
    if (!children) childrenByParent.set(parent, (children = []))
    children.push(header)
  }

  const resolveRootId = (id: SessionId): SessionId => {
    let current = id
    const seen = new Set<SessionId>([current])
    while (true) {
      const parent = parentOf.get(current)
      if (!parent || seen.has(parent)) break
      seen.add(parent)
      current = parent
    }
    return current
  }

  const collectDescendantsPostOrder = (rootId: SessionId): SessionId[] => {
    const descendants: SessionId[] = []
    const visited = new Set<SessionId>([rootId])
    const visit = (parentId: SessionId) => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (visited.has(child.id)) continue
        visited.add(child.id)
        visit(child.id)
        descendants.push(child.id)
      }
    }
    visit(rootId)
    return descendants
  }

  const missingRootIds = new Set<SessionId>()
  for (const parent of parentOf.values()) {
    if (!headers.has(parent)) missingRootIds.add(resolveRootId(parent))
  }

  const missingRoots = new Map<SessionId, MissingRootInfo>()
  for (const rootId of missingRootIds) {
    const directChildren = childrenByParent.get(rootId) ?? []
    if (!directChildren.length) continue
    let cwd = directChildren.find((header) => header.cwd !== undefined)?.cwd
    if (cwd === undefined) {
      for (const descId of collectDescendantsPostOrder(rootId)) {
        const descCwd = headers.get(descId)?.cwd
        if (descCwd !== undefined) {
          cwd = descCwd
          break
        }
      }
    }
    missingRoots.set(rootId, {
      id: rootId,
      createdAt: directChildren[0].createdAt,
      ...(cwd !== undefined ? { cwd } : {}),
    })
  }

  return {
    headers,
    locations,
    parentOf,
    childrenByParent,
    missingRoots,
    resolveRootId,
    collectDescendantsPostOrder,
  }
}
