import * as css from 'css-tree'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { root } from '../manifest.ts'
import {
  collectFiles,
  identifierOrString,
  isCssNode,
  isSourceNode,
  lineOf,
  parseCssSheet,
  parseSourceModule,
  stringValue,
  toPosixRelative,
  walkSourceAst,
  type SourceNode,
} from './shared.ts'

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

interface CompiledRuleEntry extends ContractRuleEntry {
  normalizedValue: string
}

interface CompiledContract {
  tokens: Record<string, unknown>
  localBindings: CompiledRuleEntry[]
  decorations: CompiledRuleEntry[]
}

const OWNED_VAR = /^--(?:dsw|dsh|ds)-/

const PAINT_PROP =
  /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?|border-image(?:-source)?|outline(?:-color)?|(?:box|text)-shadow|fill|stroke|text-decoration(?:-color)?|(?:stop|flood|lighting|caret|accent)-color)$/

const COLOR_FUNCTIONS = new Set([
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

const THEME_BRANCH = /prefers-color-scheme|data-(?:ds-)?(?:dark-theme|theme(?:-source)?)\b/i

const kebab = (name: string): string =>
  name.startsWith('--') ? name : name.replace(/[A-Z]/g, (s) => `-${s.toLowerCase()}`)

const normalizeValue = (value: string): string =>
  css.generate(css.parse(value, { context: 'value' }))

let cachedDefaultContract: ContractRules | undefined
const compiledContracts = new WeakMap<ContractRules, CompiledContract>()

function defaultContract(): ContractRules {
  cachedDefaultContract ??= JSON.parse(
    readFileSync(new URL('./ui-contract.json', import.meta.url), 'utf8'),
  ) as ContractRules
  return cachedDefaultContract
}

function compileContract(rules: ContractRules): CompiledContract {
  let compiled = compiledContracts.get(rules)
  if (compiled) return compiled

  const normalizeEntries = (entries: ContractRuleEntry[]): CompiledRuleEntry[] =>
    entries.map((entry) => ({ ...entry, normalizedValue: normalizeValue(entry.value) }))

  compiled = {
    tokens: rules.tokens,
    localBindings: normalizeEntries(rules.localBindings),
    decorations: normalizeEntries(rules.decorations),
  }
  compiledContracts.set(rules, compiled)
  return compiled
}

function checkValueNode(
  node: css.CssNode,
  property: string,
  decoration: boolean,
  line: number,
  tokens: Record<string, unknown>,
  report: (line: number, message: string) => void,
): void {
  if (node.type === 'Raw') {
    report(line, '无法解析样式值')
    return
  }

  if (node.type === 'Function' && typeof node.name === 'string') {
    const name = css.ident.decode(node.name).toLowerCase()
    if (name === 'var') {
      const first = node.children?.first
      const token =
        first?.type === 'Identifier' && typeof first.name === 'string'
          ? css.ident.decode(first.name)
          : ''
      if (OWNED_VAR.test(token) && !Object.hasOwn(tokens, token)) {
        report(line, `未登记的宿主 token：${token}`)
      }
      return
    }
    if (name === 'light-dark') {
      report(line, '禁止使用 light-dark()')
      return
    }
    if (!decoration && COLOR_FUNCTIONS.has(name)) {
      report(line, `禁止硬编码颜色：${name}()`)
    }
    return
  }

  if (!decoration && node.type === 'Hash' && typeof node.value === 'string') {
    report(line, `禁止硬编码颜色：#${node.value}`)
    return
  }

  if (
    !decoration &&
    node.type === 'Identifier' &&
    typeof node.name === 'string' &&
    (PAINT_PROP.test(property) || property.startsWith('--'))
  ) {
    const name = css.ident.decode(node.name).toLowerCase()
    if (
      name !== 'transparent' &&
      name !== 'currentcolor' &&
      css.lexer.matchType('color', name).matched
    ) {
      report(line, `禁止硬编码颜色：${name}`)
    }
  }
}

function createInspector(file: string, rules: ContractRules) {
  const compiled = compileContract(rules)
  const errors: string[] = []
  const report = (line: number, message: string) => errors.push(`${file}:${line}: ${message}`)

  function declaration(
    rawProperty: string,
    valueNode: css.CssNode,
    selector: string,
    line: number,
    conditional = false,
  ): void {
    const decoded = css.ident.decode(rawProperty)
    const property = decoded.startsWith('--') ? decoded : decoded.toLowerCase()
    const normalized = css.generate(valueNode)

    const matches = (entry: CompiledRuleEntry) =>
      !conditional &&
      entry.file === file &&
      entry.selector === selector &&
      entry.property === property &&
      entry.normalizedValue === normalized

    if (OWNED_VAR.test(property) && !compiled.localBindings.some(matches)) {
      report(line, `禁止重定义宿主变量：${property}`)
    }
    if (property === 'color-scheme') {
      report(line, '禁止声明 color-scheme')
    }

    const decoration = compiled.decorations.some(matches)
    css.walk(valueNode, (node) =>
      checkValueNode(node, property, decoration, line, compiled.tokens, report),
    )
  }

  function inlineValue(property: string, source: string, line: number): void {
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

  return { errors, report, declaration, inlineValue }
}

export function checkCss(
  source: string,
  file: string,
  rules: ContractRules = defaultContract(),
): string[] {
  const ast = parseCssSheet(source, file)
  if (typeof ast === 'string') return [ast]

  const inspector = createInspector(file, rules)
  let ruleDepth = 0

  css.walk(ast, {
    enter(node) {
      if (node.type === 'Rule') ruleDepth++
      const line = node.loc?.start.line ?? 1

      if (node.type === 'Raw') inspector.report(line, '无法解析 CSS 节点')
      if (node.type === 'Atrule' && node.prelude && THEME_BRANCH.test(css.generate(node.prelude))) {
        inspector.report(line, '禁止使用明暗主题媒体查询')
      }
      if (node.type === 'AttributeSelector' && THEME_BRANCH.test(css.generate(node))) {
        inspector.report(line, '禁止使用宿主主题属性选择器')
      }
      if (
        node.type === 'Declaration' &&
        typeof node.property === 'string' &&
        isCssNode(node.value)
      ) {
        inspector.declaration(
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

  return [...new Set(inspector.errors)]
}

const isStyleMember = (node: SourceNode | undefined): boolean =>
  node?.type === 'MemberExpression' && identifierOrString(node.property) === 'style'

export function checkSource(
  source: string,
  file: string,
  rules: ContractRules = defaultContract(),
): string[] {
  const ast = parseSourceModule(source, file)
  if (typeof ast === 'string') return [ast]

  const inspector = createInspector(file, rules)

  function inspectExpression(property: string, node: SourceNode | undefined): void {
    if (!node) return
    if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') {
      inspector.inlineValue(property, String(node.value), lineOf(node))
    } else if (node.type === 'TemplateLiteral' && !node.expressions?.length) {
      inspector.inlineValue(property, node.quasis?.[0]?.value.cooked ?? '', lineOf(node))
    } else if (node.type === 'ConditionalExpression') {
      inspectExpression(property, node.consequent)
      inspectExpression(property, node.alternate)
    } else if (
      node.type === 'TSAsExpression' ||
      node.type === 'TSSatisfiesExpression' ||
      node.type === 'TSNonNullExpression'
    ) {
      inspectExpression(property, node.expression)
    } else if (PAINT_PROP.test(property) || OWNED_VAR.test(property)) {
      inspector.report(lineOf(node), `样式属性 ${property} 不支持动态表达式`)
    }
  }

  walkSourceAst(ast, (node) => {
    const line = lineOf(node)

    if (node.type === 'ObjectProperty') {
      const property = kebab(identifierOrString(node.key))
      const valueNode = isSourceNode(node.value) ? node.value : undefined
      if (
        PAINT_PROP.test(property) ||
        property === 'color-scheme' ||
        property.startsWith('--') ||
        stringValue(valueNode)?.includes('var(')
      ) {
        inspectExpression(property, valueNode)
      }
      return
    }

    if (node.type === 'JSXAttribute') {
      const property = kebab(identifierOrString(isSourceNode(node.name) ? node.name : undefined))
      if (!PAINT_PROP.test(property)) return
      const attrValue = isSourceNode(node.value) ? node.value : undefined
      inspectExpression(
        property,
        attrValue?.type === 'JSXExpressionContainer' ? attrValue.expression : attrValue,
      )
      return
    }

    if (
      node.type === 'AssignmentExpression' &&
      node.left?.type === 'MemberExpression' &&
      isStyleMember(node.left.object)
    ) {
      const property = kebab(identifierOrString(node.left.property))
      if (property === 'css-text') inspector.report(line, '禁止使用 style.cssText')
      else inspectExpression(property, node.right)
      return
    }

    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const method = identifierOrString(node.callee.property)
      if (method === 'setProperty' && isStyleMember(node.callee.object)) {
        const property = stringValue(node.arguments?.[0])
        if (property !== undefined) inspectExpression(property, node.arguments?.[1])
        else inspector.report(line, 'style.setProperty 属性名必须为静态字符串')
      } else if (method === 'setAttribute') {
        const attrName = stringValue(node.arguments?.[0])
        if (attrName === undefined) return
        const property = kebab(attrName)
        if (PAINT_PROP.test(property)) inspectExpression(property, node.arguments?.[1])
        if (property === 'style') inspector.report(line, '禁止通过 setAttribute 设置 style')
      }
      return
    }

    const literal = stringValue(node)
    if (literal !== undefined && THEME_BRANCH.test(literal)) {
      inspector.report(line, '禁止在脚本中匹配宿主主题条件')
    }
  })

  return [...new Set(inspector.errors)]
}

export async function runUiContractCheck(
  rules: ContractRules = defaultContract(),
): Promise<{ fileCount: number; version: string; errors: string[] }> {
  const targets = (await collectFiles(path.join(root, 'src'))).filter(
    (file) => file.split(path.sep).includes('client') && /\.(?:css|[cm]?[jt]sx?)$/.test(file),
  )

  const errors = (
    await Promise.all(
      targets.map(async (file) => {
        const relative = toPosixRelative(file)
        const source = await readFile(file, 'utf8')
        return file.endsWith('.css')
          ? checkCss(source, relative, rules)
          : checkSource(source, relative, rules)
      }),
    )
  ).flat()

  return { fileCount: targets.length, version: rules.baseline.version, errors }
}
