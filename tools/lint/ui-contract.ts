import { parse as parseSource } from '@babel/parser'
import * as css from 'css-tree'
import { readFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { root } from '../manifest.ts'

export interface ContractRuleEntry {
  file: string
  selector: string
  property: string
  value: string
}

export interface ContractRules {
  baseline: {
    version: string
  }
  tokens: Record<string, unknown>
  localBindings: ContractRuleEntry[]
  decorations: ContractRuleEntry[]
}

interface SourceAstNode {
  type?: string
  loc?: {
    start?: { line?: number }
  } | null
  name?: string | SourceAstNode
  value?: unknown
  key?: SourceAstNode
  property?: SourceAstNode
  object?: SourceAstNode
  callee?: SourceAstNode
  left?: SourceAstNode
  right?: SourceAstNode
  expression?: SourceAstNode
  consequent?: SourceAstNode
  alternate?: SourceAstNode
  expressions?: SourceAstNode[]
  quasis?: Array<{ value: { cooked?: string | null } }>
  arguments?: SourceAstNode[]
  [key: string]: unknown
}

const owned = /^--(?:dsw|dsh|ds)-/

const paint =
  /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?|border-image(?:-source)?|outline(?:-color)?|(?:box|text)-shadow|fill|stroke|text-decoration(?:-color)?|(?:stop|flood|lighting|caret|accent)-color)$/

const colorFunctions = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'device-cmyk',
])

const themeBranch = /prefers-color-scheme|data-(?:ds-)?(?:dark-theme|theme(?:-source)?)\b/i

const normalize = (value: string): string => css.generate(css.parse(value, { context: 'value' }))

const kebab = (name: string): string =>
  name.startsWith('--') ? name : name.replace(/[A-Z]/g, (s) => `-${s.toLowerCase()}`)

let cachedContract: ContractRules | undefined

export function loadDefaultContract(): ContractRules {
  cachedContract ??= JSON.parse(
    readFileSync(new URL('./ui-contract.json', import.meta.url), 'utf8'),
  ) as ContractRules
  return cachedContract
}

function inspector(file: string, rules: ContractRules) {
  const errors: string[] = []
  const report = (line: number, message: string) => errors.push(`${file}:${line}: ${message}`)

  function declaration(
    rawProperty: string,
    valueNode: css.CssNode,
    selector: string,
    line: number,
    conditional = false,
  ): void {
    let property = css.ident.decode(rawProperty)
    if (!property.startsWith('--')) property = property.toLowerCase()
    const normalized = css.generate(valueNode)

    const matches = (entry: ContractRuleEntry) =>
      !conditional &&
      entry.file === file &&
      entry.selector === selector &&
      entry.property === property &&
      normalize(entry.value) === normalized

    if (owned.test(property) && !rules.localBindings.some(matches)) {
      report(line, `不允许重定义宿主变量 ${property}；仅允许契约列出的局部重绑`)
    }
    if (property === 'color-scheme') report(line, '明暗主题由 DSH 宿主管理')

    const decoration = rules.decorations.some(matches)
    css.walk(valueNode, (node) => {
      if (node.type === 'Raw') report(line, '无法解析样式值；不能跳过 UI 检查')
      if (node.type === 'Function' && typeof node.name === 'string') {
        const name = css.ident.decode(node.name).toLowerCase()
        if (name === 'var') {
          const first = node.children?.first
          const token =
            first?.type === 'Identifier' && typeof first.name === 'string'
              ? css.ident.decode(first.name)
              : ''
          if (owned.test(token) && !Object.hasOwn(rules.tokens, token)) {
            report(line, `未登记的 DSH token ${token}；先核对固定版本官方来源与语义`)
          }
        }
        if (name === 'light-dark') report(line, '不要在插件自行分支明暗配色；使用 DSH 语义 token')
        if (!decoration && colorFunctions.has(name)) {
          report(line, `硬编码颜色 ${name}()；使用 DSH 语义 token`)
        }
      }
      if (!decoration && node.type === 'Hash' && typeof node.value === 'string') {
        report(line, `硬编码颜色 #${node.value}；使用 DSH 语义 token`)
      }
      if (
        !decoration &&
        node.type === 'Identifier' &&
        typeof node.name === 'string' &&
        (paint.test(property) || property.startsWith('--'))
      ) {
        const name = css.ident.decode(node.name).toLowerCase()
        if (
          !['transparent', 'currentcolor'].includes(name) &&
          css.lexer.matchType('color', name).matched
        ) {
          report(line, `硬编码颜色 ${name}；使用 DSH 语义 token`)
        }
      }
    })
  }

  function value(property: string, source: string, line: number): void {
    try {
      declaration(
        property,
        css.parse(source, { context: 'value', parseCustomProperty: true }),
        '<inline>',
        line,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report(line, `无法解析内联样式：${message}`)
    }
  }

  return { errors, report, declaration, value }
}

export function checkCss(
  source: string,
  file: string,
  rules: ContractRules = loadDefaultContract(),
): string[] {
  const check = inspector(file, rules)
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
    check.report(line, `无法解析 CSS：${message}`)
    return check.errors
  }

  let ruleDepth = 0
  css.walk(ast, {
    enter(node) {
      if (node.type === 'Rule') ruleDepth++
      const line = node.loc?.start.line ?? 1

      if (node.type === 'Raw') check.report(line, '无法解析 CSS；不能跳过 UI 检查')
      if (node.type === 'Atrule' && node.prelude && themeBranch.test(css.generate(node.prelude))) {
        check.report(line, '不要根据系统明暗重建主题；继承 DSH token')
      }
      if (node.type === 'AttributeSelector' && themeBranch.test(css.generate(node))) {
        check.report(line, '不要根据宿主主题属性分支配色；继承 DSH token')
      }
      if (
        node.type === 'Declaration' &&
        typeof node.property === 'string' &&
        node.value &&
        typeof node.value === 'object'
      ) {
        check.declaration(
          node.property,
          node.value,
          this.rule?.prelude ? css.generate(this.rule.prelude) : '',
          line,
          Boolean(this.atrule) || ruleDepth > 1,
        )
      }
    },
    leave(node) {
      if (node.type === 'Rule') ruleDepth--
    },
  })

  return [...new Set(check.errors)]
}

export function checkSource(
  source: string,
  file: string,
  rules: ContractRules = loadDefaultContract(),
): string[] {
  const check = inspector(file, rules)
  let ast: SourceAstNode
  try {
    ast = parseSource(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    }) as unknown as SourceAstNode
  } catch (error) {
    const line = (error as { loc?: { line?: number } }).loc?.line ?? 1
    const message = error instanceof Error ? error.message : String(error)
    check.report(line, `无法解析源码：${message}`)
    return check.errors
  }

  const lineOf = (node: SourceAstNode) => node.loc?.start?.line ?? 1

  const nameOf = (node: SourceAstNode | undefined): string => {
    if (!node) return ''
    if (node.type === 'StringLiteral' && typeof node.value === 'string') return node.value
    return typeof node.name === 'string' ? node.name : ''
  }

  const isStyle = (node: SourceAstNode | undefined): boolean =>
    node?.type === 'MemberExpression' && nameOf(node.property) === 'style'

  function expression(property: string, node: SourceAstNode | undefined): void {
    if (!node) return
    if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') {
      check.value(property, String(node.value), lineOf(node))
    } else if (node.type === 'TemplateLiteral' && !node.expressions?.length) {
      check.value(property, node.quasis?.[0]?.value.cooked ?? '', lineOf(node))
    } else if (node.type === 'ConditionalExpression') {
      expression(property, node.consequent)
      expression(property, node.alternate)
    } else if (
      node.type &&
      ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression'].includes(node.type)
    ) {
      expression(property, node.expression)
    } else if (paint.test(property) || owned.test(property)) {
      check.report(lineOf(node), `无法静态检查 ${property}；将颜色或宿主变量写入 CSS 语义类`)
    }
  }

  function visit(node: SourceAstNode): void {
    if (node.type === 'ObjectProperty') {
      const property = kebab(nameOf(node.key))
      if (
        paint.test(property) ||
        property === 'color-scheme' ||
        property.startsWith('--') ||
        (node.value &&
          typeof node.value === 'object' &&
          (node.value as SourceAstNode).type === 'StringLiteral' &&
          typeof (node.value as SourceAstNode).value === 'string' &&
          ((node.value as SourceAstNode).value as string).includes('var('))
      ) {
        expression(property, node.value as SourceAstNode)
      }
    }

    if (node.type === 'JSXAttribute') {
      const property = kebab(nameOf(node.name as SourceAstNode | undefined))
      if (paint.test(property)) {
        const attrValue = node.value as SourceAstNode | undefined
        expression(
          property,
          attrValue?.type === 'JSXExpressionContainer' ? attrValue.expression : attrValue,
        )
      }
    }

    if (
      node.type === 'AssignmentExpression' &&
      node.left?.type === 'MemberExpression' &&
      isStyle(node.left.object)
    ) {
      const property = kebab(nameOf(node.left.property))
      if (property === 'css-text') check.report(lineOf(node), '不要通过 cssText 绕过 CSS 检查')
      else expression(property, node.right)
    }

    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const method = nameOf(node.callee.property)
      if (method === 'setProperty' && isStyle(node.callee.object)) {
        const property = node.arguments?.[0]
        if (property?.type === 'StringLiteral' && typeof property.value === 'string') {
          expression(property.value, node.arguments?.[1])
        } else {
          check.report(lineOf(node), 'style.setProperty 必须使用可检查的固定属性名')
        }
      }
      if (
        method === 'setAttribute' &&
        node.arguments?.[0]?.type === 'StringLiteral' &&
        typeof node.arguments[0].value === 'string'
      ) {
        const property = kebab(node.arguments[0].value)
        if (paint.test(property)) expression(property, node.arguments?.[1])
        if (property === 'style') check.report(lineOf(node), '不要通过 style 字符串绕过 CSS 检查')
      }
    }

    if (
      node.type === 'StringLiteral' &&
      typeof node.value === 'string' &&
      themeBranch.test(node.value)
    ) {
      check.report(lineOf(node), '插件不自行分支宿主明暗主题')
    }

    for (const [key, child] of Object.entries(node)) {
      if (
        ['loc', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)
      ) {
        continue
      }
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && 'type' in item) visit(item as SourceAstNode)
        }
      } else if (child && typeof child === 'object' && 'type' in child) {
        visit(child as SourceAstNode)
      }
    }
  }

  visit(ast)
  return [...new Set(check.errors)]
}

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const lists = await Promise.all(
    entries.map((entry) => {
      const name = path.join(directory, entry.name)
      return entry.isDirectory()
        ? filesIn(name)
        : /\.(?:css|[cm]?[jt]sx?)$/.test(name)
          ? Promise.resolve([name])
          : Promise.resolve([])
    }),
  )
  return lists.flat().sort()
}

export async function runUiContractCheck(
  files?: string[],
  rules: ContractRules = loadDefaultContract(),
): Promise<{ fileCount: number; version: string; errors: string[] }> {
  const targets =
    files ??
    (await filesIn(path.join(root, 'src'))).filter((file) =>
      file.split(path.sep).includes('client'),
    )

  const errors = (
    await Promise.all(
      targets.map(async (file) => {
        const relative = path.relative(root, file).split(path.sep).join('/')
        const source = await readFile(file, 'utf8')
        return file.endsWith('.css')
          ? checkCss(source, relative, rules)
          : checkSource(source, relative, rules)
      }),
    )
  ).flat()

  return { fileCount: targets.length, version: rules.baseline.version, errors }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const explicit =
    process.argv.length > 2 ? process.argv.slice(2).map((name) => path.resolve(name)) : undefined
  const { fileCount, version, errors } = await runUiContractCheck(explicit)
  for (const error of errors) console.error(error)
  if (errors.length) process.exitCode = 1
  else console.log(`UI 契约检查通过：${fileCount} 个文件，DSH ${version}`)
}
