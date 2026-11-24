import type { SessionRow } from './protocol.ts'

export interface SessionNode {
  row: SessionRow
  depth: number
  children: SessionNode[]
  descendants: SessionRow[]
  maxSubtreeDepth: number
  descendantLive: boolean
}

function createsCycle(
  childId: string,
  parentId: string,
  parents: ReadonlyMap<string, string>,
): boolean {
  let current: string | undefined = parentId
  const seen = new Set<string>([childId])
  while (current !== undefined) {
    if (seen.has(current)) return true
    seen.add(current)
    current = parents.get(current)
  }
  return false
}

function finalizeNode(node: SessionNode, depth: number): void {
  node.depth = depth
  node.children.sort(
    (a, b) => a.row.createdAt - b.row.createdAt || a.row.id.localeCompare(b.row.id),
  )
  const descendants: SessionRow[] = []
  let maxSubtreeDepth = 0
  for (const child of node.children) {
    finalizeNode(child, depth + 1)
    descendants.push(child.row, ...child.descendants)
    maxSubtreeDepth = Math.max(maxSubtreeDepth, 1 + child.maxSubtreeDepth)
  }
  node.descendants = descendants
  node.maxSubtreeDepth = maxSubtreeDepth
  node.descendantLive = descendants.some((item) => item.live)
}

function matchesRow(row: SessionRow, filter: string): boolean {
  return [row.title, row.id, row.cwd, row.workspace.title].some((field) =>
    field?.toLowerCase().includes(filter),
  )
}

function filterNode(node: SessionNode, filter: string): SessionNode | null {
  if (matchesRow(node.row, filter)) return node
  const children = node.children
    .map((child) => filterNode(child, filter))
    .filter((child): child is SessionNode => child !== null)
  if (!children.length) return null
  return {
    row: node.row,
    depth: node.depth,
    children,
    descendants: node.descendants,
    maxSubtreeDepth: node.maxSubtreeDepth,
    descendantLive: node.descendantLive,
  }
}

export function buildSessionTree(
  rows: readonly SessionRow[],
  query?: string,
  archived?: boolean,
): SessionNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const workspaceOrder = new Map<string, number>()
  for (const row of rows) {
    if (!workspaceOrder.has(row.workspace.key)) {
      workspaceOrder.set(row.workspace.key, workspaceOrder.size)
    }
  }

  const subagentRows = rows
    .filter((row) => row.subagent)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

  const parents = new Map<string, string>()
  const missingChildren = new Map<string, SessionRow[]>()

  for (const row of subagentRows) {
    const resolved =
      row.parentId && !createsCycle(row.id, row.parentId, parents)
        ? row.parentId
        : `missing-root:${row.id}`
    parents.set(row.id, resolved)
    if (!byId.has(resolved)) {
      let group = missingChildren.get(resolved)
      if (!group) missingChildren.set(resolved, (group = []))
      group.push(row)
    }
  }

  const nodes = new Map<string, SessionNode>(
    rows.map((row) => [
      row.id,
      { row, depth: 0, children: [], descendants: [], maxSubtreeDepth: 0, descendantLive: false },
    ]),
  )
  const roots: SessionNode[] = []

  for (const [missingId, directChildren] of missingChildren) {
    const firstChild = directChildren[0]
    const cwd = directChildren.find((child) => child.cwd !== undefined)?.cwd
    const syntheticRow: SessionRow = {
      id: missingId,
      createdAt: firstChild.createdAt,
      ...(cwd !== undefined ? { cwd } : {}),
      title: '主会话已缺失',
      workspace: firstChild.workspace,
      canOpenDirectory: false,
      archived: directChildren.every((child) => child.archived),
      live: false,
      subagent: false,
      missing: true,
    }
    const syntheticNode: SessionNode = {
      row: syntheticRow,
      depth: 0,
      children: [],
      descendants: [],
      maxSubtreeDepth: 0,
      descendantLive: false,
    }
    nodes.set(missingId, syntheticNode)
    roots.push(syntheticNode)
  }

  for (const row of rows) {
    const node = nodes.get(row.id)!
    const parentId = parents.get(row.id)
    if (parentId !== undefined) nodes.get(parentId)!.children.push(node)
    else roots.push(node)
  }

  if (missingChildren.size > 0) {
    roots.sort(
      (a, b) =>
        (workspaceOrder.get(a.row.workspace.key) ?? workspaceOrder.size) -
          (workspaceOrder.get(b.row.workspace.key) ?? workspaceOrder.size) ||
        b.row.createdAt - a.row.createdAt ||
        a.row.id.localeCompare(b.row.id),
    )
  }

  for (const root of roots) finalizeNode(root, 0)

  const scoped =
    archived === undefined ? roots : roots.filter((root) => root.row.archived === archived)

  const filter = query?.trim().toLowerCase() ?? ''
  if (!filter) return scoped
  return scoped
    .map((root) => filterNode(root, filter))
    .filter((root): root is SessionNode => root !== null)
}

export function collectExpandableIds(nodes: readonly SessionNode[]): string[] {
  const ids: string[] = []
  const visit = (list: readonly SessionNode[]) => {
    for (const node of list) {
      if (!node.children.length) continue
      ids.push(node.row.id)
      visit(node.children)
    }
  }
  visit(nodes)
  return ids
}
