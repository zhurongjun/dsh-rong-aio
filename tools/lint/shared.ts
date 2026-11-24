import { parse as parseSource } from '@babel/parser'
import * as css from 'css-tree'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { root } from '../manifest.ts'

export interface SourceNode {
  type: string
  loc?: {
    start?: { line?: number }
  } | null
  name?: string | SourceNode
  value?: unknown
  key?: SourceNode
  property?: SourceNode
  object?: SourceNode
  callee?: SourceNode
  left?: SourceNode
  right?: SourceNode
  source?: SourceNode | null
  argument?: SourceNode | null
  expression?: SourceNode
  consequent?: SourceNode
  alternate?: SourceNode
  expressions?: SourceNode[]
  quasis?: Array<{ value: { cooked?: string | null } }>
  arguments?: SourceNode[]
  [key: string]: unknown
}

const AST_META_KEYS = new Set([
  'loc',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

export function isSourceNode(value: unknown): value is SourceNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

export function isCssNode(value: unknown): value is css.CssNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

export function lineOf(node: SourceNode | null | undefined): number {
  return node?.loc?.start?.line ?? 1
}

export function stringValue(node: SourceNode | null | undefined): string | undefined {
  return node?.type === 'StringLiteral' && typeof node.value === 'string' ? node.value : undefined
}

export function identifierOrString(node: SourceNode | null | undefined): string {
  if (!node) return ''
  const literal = stringValue(node)
  if (literal !== undefined) return literal
  return typeof node.name === 'string' ? node.name : ''
}

export function parseSourceModule(source: string, file: string): SourceNode | string {
  try {
    return parseSource(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    }) as unknown as SourceNode
  } catch (error) {
    const line = (error as { loc?: { line?: number } }).loc?.line ?? 1
    const message = error instanceof Error ? error.message : String(error)
    return `${file}:${line}: 无法解析源码：${message}`
  }
}

export function walkSourceAst(node: SourceNode, visit: (node: SourceNode) => void): void {
  visit(node)
  for (const [key, child] of Object.entries(node)) {
    if (AST_META_KEYS.has(key)) continue
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isSourceNode(item)) walkSourceAst(item, visit)
      }
    } else if (isSourceNode(child)) {
      walkSourceAst(child, visit)
    }
  }
}

export function parseCssSheet(source: string, file: string): css.CssNode | string {
  try {
    return css.parse(source, {
      positions: true,
      parseCustomProperty: true,
      onParseError(error) {
        throw error
      },
    })
  } catch (error) {
    const line = (error as { line?: number }).line ?? 1
    const message = error instanceof Error ? error.message : String(error)
    return `${file}:${line}: 无法解析 CSS：${message}`
  }
}

export async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(directory, entry.name)
      return entry.isDirectory() ? collectFiles(fullPath) : Promise.resolve([fullPath])
    }),
  )
  return nested.flat().sort()
}

export function toPosixRelative(file: string): string {
  return path.relative(root, file).split(path.sep).join('/')
}
