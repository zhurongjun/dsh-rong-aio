import * as css from 'css-tree'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { root } from '../manifest.ts'
import {
  collectFiles,
  lineOf,
  parseCssSheet,
  parseSourceModule,
  stringValue,
  toPosixRelative,
  walkSourceAst,
} from './shared.ts'

const DOCUMENT_NAME =
  /^(?:readme|changelog|contributing)$|\.(?:md|mdx|mdoc|markdown|mdown|mdwn|mkd|mkdn|mkdown|markdn|mdtxt|mdtext|rmd|rmarkdown|qmd|txt|text|rst|rest|adoc|asciidoc|org|rtf|pdf|docx?|odt)$/i

const componentOf = (file: string): string | undefined =>
  /^src\/components\/([^/]+)\//.exec(file)?.[1]

const sideOf = (file: string): string | undefined =>
  /(?:^|\/)(host|client|shared)\//.exec(file)?.[1]

function checkTarget(
  file: string,
  line: number,
  value: string,
  report: (line: number, message: string) => void,
): void {
  if (/^dsh-rong-aio(?:$|[-/])/.test(value)) {
    report(line, `禁止通过包名导入内部模块：${value}`)
    return
  }
  if (!value.startsWith('.')) return

  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), value))
  const from = componentOf(file)
  const to = componentOf(target)

  if (from && to && from !== to) {
    report(line, `禁止跨组件导入：${value}`)
  }
  if (!from && to && !file.startsWith('src/runtime/')) {
    report(line, `根基础层禁止导入业务组件：${to}`)
  }
  if (file.startsWith('src/shared/') && !target.startsWith('src/shared/')) {
    report(line, `src/shared 禁止导入外部模块：${value}`)
  }
  if (from && target.startsWith('src/runtime/')) {
    report(line, '业务组件禁止导入 runtime 装配层')
  }

  const side = sideOf(file)
  const targetSide = sideOf(target)
  if (
    (side === 'host' && targetSide === 'client') ||
    (side === 'client' && targetSide === 'host') ||
    (side === 'shared' && (targetSide === 'host' || targetSide === 'client'))
  ) {
    report(line, `禁止 ${side} 导入 ${targetSide}：${value}`)
  }
}

export function checkImports(source: string, file: string): string[] {
  const ast = parseSourceModule(source, file)
  if (typeof ast === 'string') return [ast]

  const errors: string[] = []
  const report = (line: number, message: string) => errors.push(`${file}:${line}: ${message}`)

  walkSourceAst(ast, (node) => {
    const line = lineOf(node)

    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      const spec = stringValue(node.source)
      if (spec !== undefined) checkTarget(file, line, spec, report)
      return
    }

    if (node.type === 'TSImportType') {
      const spec = stringValue(node.argument)
      if (spec !== undefined) checkTarget(file, line, spec, report)
      return
    }

    if (node.type === 'CallExpression' && node.callee?.type === 'Import') {
      const spec = stringValue(node.arguments?.[0])
      if (spec !== undefined) checkTarget(file, line, spec, report)
      else report(line, '动态 import 参数必须为静态字符串')
    }
  })

  return errors
}

function extractCssImportTarget(node: css.CssNode): string | undefined {
  if (!node.prelude?.children) return undefined
  for (const child of node.prelude.children) {
    if ((child.type === 'String' || child.type === 'Url') && typeof child.value === 'string') {
      return child.value
    }
  }
  return undefined
}

export function checkCssImports(source: string, file: string): string[] {
  const ast = parseCssSheet(source, file)
  if (typeof ast === 'string') return [ast]

  const errors: string[] = []
  const report = (line: number, message: string) => errors.push(`${file}:${line}: ${message}`)

  css.walk(ast, (node) => {
    if (node.type !== 'Atrule' || typeof node.name !== 'string') return
    if (css.ident.decode(node.name).toLowerCase() !== 'import') return

    const line = node.loc?.start.line ?? 1
    const target = extractCssImportTarget(node)
    if (target === undefined) {
      report(line, 'CSS @import 路径必须为静态字符串或 url(...)')
      return
    }

    checkTarget(file, line, target, report)
  })

  return errors
}

export async function runBoundariesCheck(): Promise<{ fileCount: number; errors: string[] }> {
  const targets = await collectFiles(path.join(root, 'src'))
  const errors = (
    await Promise.all(
      targets.map(async (file) => {
        const relative = toPosixRelative(file)
        if (DOCUMENT_NAME.test(path.basename(file))) {
          return [`${relative}: src/ 禁止存放文档文件`]
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
