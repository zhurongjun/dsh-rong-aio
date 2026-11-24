import { parse as parseSource } from '@babel/parser'
import * as css from 'css-tree'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { root } from '../manifest.ts'

interface SourceAstNode {
  type?: string
  loc?: {
    start?: { line?: number }
    line?: number
  } | null
  value?: unknown
  name?: string
  source?: SourceAstNode | null
  argument?: SourceAstNode | null
  callee?: SourceAstNode | null
  arguments?: SourceAstNode[]
  [key: string]: unknown
}

const documentName =
  /^(?:readme|changelog|contributing)$|\.(?:md|mdx|mdoc|markdown|mdown|mdwn|mkd|mkdn|mkdown|markdn|mdtxt|mdtext|rmd|rmarkdown|qmd|txt|text|rst|rest|adoc|asciidoc|org|rtf|pdf|docx?|odt)$/i

const owner = (file: string): string | undefined => /^src\/components\/([^/]+)\//.exec(file)?.[1]

const layer = (file: string): string | undefined => /(?:^|\/)(host|client|shared)\//.exec(file)?.[1]

function checkTarget(
  file: string,
  line: number,
  value: string,
  report: (line: number, message: string) => void,
): void {
  if (/^dsh-rong-aio(?:$|[-/])/.test(value)) {
    report(line, '项目内部使用相对导入；不得通过包名绕过组件边界')
    return
  }
  if (!value.startsWith('.')) return

  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), value))
  const from = owner(file)
  const to = owner(target)

  if (from && to && from !== to) {
    report(line, '组件不得导入其他组件内部；通过公开服务契约协作')
  }
  if (!from && to && !file.startsWith('src/runtime/')) {
    report(line, '根基础层不得反向依赖具体业务组件')
  }
  if (file.startsWith('src/shared/') && !target.startsWith('src/shared/')) {
    report(line, '根 Shared 只能依赖跨组件共享的纯类型、协议和工具')
  }
  if (from && target.startsWith('src/runtime/')) {
    report(line, '组件实现不得依赖装配层')
  }

  const side = layer(file)
  const targetSide = layer(target)
  if (
    (side === 'host' && targetSide === 'client') ||
    (side === 'client' && targetSide === 'host') ||
    (side === 'shared' && (targetSide === 'host' || targetSide === 'client'))
  ) {
    report(line, `${side} 不得导入 ${targetSide}；共用协议放在 shared`)
  }
}

export function checkImports(source: string, file: string): string[] {
  const errors: string[] = []
  const report = (line: number, message: string) => errors.push(`${file}:${line}: ${message}`)

  let ast: SourceAstNode
  try {
    ast = parseSource(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    }) as unknown as SourceAstNode
  } catch (error) {
    const line = (error as { loc?: { line?: number } }).loc?.line ?? 1
    const message = error instanceof Error ? error.message : String(error)
    return [`${file}:${line}: 无法解析导入：${message}`]
  }

  function visit(node: SourceAstNode): void {
    const line = node.loc?.start?.line ?? 1

    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      if (typeof node.source?.value === 'string') checkTarget(file, line, node.source.value, report)
    }

    if (node.type === 'TSImportType' || node.type === 'ImportExpression') {
      const arg = node.argument ?? node.source
      if (arg?.type === 'StringLiteral' && typeof arg.value === 'string') {
        checkTarget(file, line, arg.value, report)
      }
    }

    if (node.type === 'CallExpression' && node.callee?.type === 'Import') {
      const first = node.arguments?.[0]
      if (first?.type === 'StringLiteral' && typeof first.value === 'string') {
        checkTarget(file, line, first.value, report)
      } else {
        report(line, '动态 import 必须使用可检查的固定路径')
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (
        ['loc', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)
      ) {
        continue
      }
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object' && 'type' in child) visit(child as SourceAstNode)
        }
      } else if (value && typeof value === 'object' && 'type' in value) {
        visit(value as SourceAstNode)
      }
    }
  }

  visit(ast)
  return errors
}

export function checkCssImports(source: string, file: string): string[] {
  const errors: string[] = []
  const report = (line: number, message: string) => errors.push(`${file}:${line}: ${message}`)

  let ast: css.CssNode
  try {
    ast = css.parse(source, {
      positions: true,
      parseCustomProperty: true,
      onParseError(error) {
        throw error
      },
    })
  } catch (error) {
    const line = (error as { line?: number }).line ?? 1
    const message = error instanceof Error ? error.message : String(error)
    return [`${file}:${line}: 无法解析 CSS：${message}`]
  }

  css.walk(ast, (node) => {
    if (node.type !== 'Atrule' || typeof node.name !== 'string') return
    if (css.ident.decode(node.name).toLowerCase() !== 'import') return

    const line = node.loc?.start.line ?? 1
    let target: string | undefined

    if (node.prelude?.children) {
      for (const child of node.prelude.children) {
        if ((child.type === 'String' || child.type === 'Url') && typeof child.value === 'string') {
          target = child.value
          break
        }
      }
    }

    if (target === undefined) {
      report(line, '无法解析 CSS @import 路径；必须使用静态字符串或 url(...)')
      return
    }

    checkTarget(file, line, target, report)
  })

  return errors
}

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(directory, entry.name)
      return entry.isDirectory() ? filesIn(fullPath) : Promise.resolve([fullPath])
    }),
  )
  return nested.flat().sort()
}

export async function runBoundariesCheck(
  files?: string[],
): Promise<{ fileCount: number; errors: string[] }> {
  const targets = files ?? (await filesIn(path.join(root, 'src')))
  const errors = (
    await Promise.all(
      targets.map(async (file) => {
        const relative = path.relative(root, file).split(path.sep).join('/')
        if (relative.startsWith('src/') && documentName.test(path.basename(file))) {
          return [`${relative}: src/ 禁止存放独立文档`]
        }
        if (file.endsWith('.css')) {
          return checkCssImports(await readFile(file, 'utf8'), relative)
        }
        if (/\.[cm]?[jt]sx?$/.test(file)) {
          return checkImports(await readFile(file, 'utf8'), relative)
        }
        return []
      }),
    )
  ).flat()

  return { fileCount: targets.length, errors }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const explicit =
    process.argv.length > 2 ? process.argv.slice(2).map((file) => path.resolve(file)) : undefined
  const { fileCount, errors } = await runBoundariesCheck(explicit)
  for (const error of errors) console.error(error)
  if (errors.length) process.exitCode = 1
  else console.log(`源码目录与导入边界检查通过：${fileCount} 个文件`)
}
