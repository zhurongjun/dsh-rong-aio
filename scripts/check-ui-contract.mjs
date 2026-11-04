import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as css from 'css-tree'
import { parse as parseSource } from '@babel/parser'

const root = fileURLToPath(new URL('../', import.meta.url))
export const contract = JSON.parse(await readFile(new URL('./ui-contract.json', import.meta.url)))
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
const normalize = (value) => css.generate(css.parse(value, { context: 'value' }))
const kebab = (name) =>
  name.startsWith('--') ? name : name.replace(/[A-Z]/g, (s) => `-${s.toLowerCase()}`)

function inspector(file, rules) {
  const errors = []
  const report = (line, message) => errors.push(`${file}:${line}: ${message}`)
  function declaration(property, value, selector, line, conditional = false) {
    property = css.ident.decode(property)
    if (!property.startsWith('--')) property = property.toLowerCase()
    const normalized = css.generate(value)
    const matches = (entry) =>
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
    css.walk(value, (node) => {
      if (node.type === 'Raw') report(line, '无法解析样式值；不能跳过 UI 检查')
      if (node.type === 'Function') {
        const name = css.ident.decode(node.name).toLowerCase()
        if (name === 'var') {
          const first = node.children.first
          const token = first?.type === 'Identifier' ? css.ident.decode(first.name) : ''
          if (owned.test(token) && !Object.hasOwn(rules.tokens, token)) {
            report(line, `未登记的 DSH token ${token}；先核对固定版本官方来源与语义`)
          }
        }
        if (name === 'light-dark') report(line, '不要在插件自行分支明暗配色；使用 DSH 语义 token')
        if (!decoration && colorFunctions.has(name))
          report(line, `硬编码颜色 ${name}()；使用 DSH 语义 token`)
      }
      if (!decoration && node.type === 'Hash')
        report(line, `硬编码颜色 #${node.value}；使用 DSH 语义 token`)
      if (
        !decoration &&
        node.type === 'Identifier' &&
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
  function value(property, source, line) {
    try {
      declaration(
        property,
        css.parse(source, { context: 'value', parseCustomProperty: true }),
        '<inline>',
        line,
      )
    } catch (error) {
      report(line, `无法解析内联样式：${error.message}`)
    }
  }
  return { errors, report, declaration, value }
}

export function checkCss(source, file, rules = contract) {
  const check = inspector(file, rules)
  let ast
  try {
    ast = css.parse(source, {
      positions: true,
      parseCustomProperty: true,
      onParseError(error) {
        throw error
      },
    })
  } catch (error) {
    check.report(error.line ?? 1, `无法解析 CSS：${error.message}`)
    return check.errors
  }
  let ruleDepth = 0
  css.walk(ast, {
    enter: function (node) {
      if (node.type === 'Rule') ruleDepth++
      const line = node.loc?.start.line ?? 1
      if (node.type === 'Raw') check.report(line, '无法解析 CSS；不能跳过 UI 检查')
      if (node.type === 'Atrule' && node.prelude && themeBranch.test(css.generate(node.prelude))) {
        check.report(line, '不要根据系统明暗重建主题；继承 DSH token')
      }
      if (node.type === 'AttributeSelector' && themeBranch.test(css.generate(node))) {
        check.report(line, '不要根据宿主主题属性分支配色；继承 DSH token')
      }
      if (node.type === 'Declaration') {
        check.declaration(
          node.property,
          node.value,
          this.rule?.prelude ? css.generate(this.rule.prelude) : '',
          line,
          !!this.atrule || ruleDepth > 1,
        )
      }
    },
    leave(node) {
      if (node.type === 'Rule') ruleDepth--
    },
  })
  return [...new Set(check.errors)]
}

// 只分析静态样式语法，不执行业务代码。动态颜色应通过 CSS 类和宿主变量表达。
export function checkSource(source, file, rules = contract) {
  const check = inspector(file, rules)
  let ast
  try {
    ast = parseSource(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  } catch (error) {
    check.report(error.loc?.line ?? 1, `无法解析源码：${error.message}`)
    return check.errors
  }
  const line = (node) => node.loc?.start.line ?? 1
  const nameOf = (node) => (node?.type === 'StringLiteral' ? node.value : (node?.name ?? ''))
  const isStyle = (node) => node?.type === 'MemberExpression' && nameOf(node.property) === 'style'
  function expression(property, node) {
    if (!node) return
    if (node.type === 'StringLiteral' || node.type === 'NumericLiteral')
      check.value(property, String(node.value), line(node))
    else if (node.type === 'TemplateLiteral' && !node.expressions.length) {
      check.value(property, node.quasis[0].value.cooked, line(node))
    } else if (node.type === 'ConditionalExpression') {
      expression(property, node.consequent)
      expression(property, node.alternate)
    } else if (
      ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression'].includes(node.type)
    ) {
      expression(property, node.expression)
    } else if (paint.test(property) || owned.test(property)) {
      check.report(line(node), `无法静态检查 ${property}；将颜色或宿主变量写入 CSS 语义类`)
    }
  }
  function visit(node) {
    if (node.type === 'ObjectProperty') {
      const property = kebab(nameOf(node.key))
      if (
        paint.test(property) ||
        property === 'color-scheme' ||
        property.startsWith('--') ||
        (node.value.type === 'StringLiteral' && node.value.value.includes('var('))
      ) {
        expression(property, node.value)
      }
    }
    if (node.type === 'JSXAttribute') {
      const property = kebab(nameOf(node.name))
      if (paint.test(property))
        expression(
          property,
          node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value,
        )
    }
    if (
      node.type === 'AssignmentExpression' &&
      node.left.type === 'MemberExpression' &&
      isStyle(node.left.object)
    ) {
      const property = kebab(nameOf(node.left.property))
      if (property === 'css-text') check.report(line(node), '不要通过 cssText 绕过 CSS 检查')
      else expression(property, node.right)
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
      const method = nameOf(node.callee.property)
      if (method === 'setProperty' && isStyle(node.callee.object)) {
        const property = node.arguments[0]
        if (property?.type === 'StringLiteral') expression(property.value, node.arguments[1])
        else check.report(line(node), 'style.setProperty 必须使用可检查的固定属性名')
      }
      if (method === 'setAttribute' && node.arguments[0]?.type === 'StringLiteral') {
        const property = kebab(node.arguments[0].value)
        if (paint.test(property)) expression(property, node.arguments[1])
        if (property === 'style') check.report(line(node), '不要通过 style 字符串绕过 CSS 检查')
      }
    }
    if (node.type === 'StringLiteral' && themeBranch.test(node.value)) {
      check.report(line(node), '插件不自行分支宿主明暗主题')
    }
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key))
        continue
      if (Array.isArray(child)) {
        for (const item of child) if (item?.type) visit(item)
      } else if (child?.type) visit(child)
    }
  }
  visit(ast)
  return [...new Set(check.errors)]
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const lists = await Promise.all(
    entries.map((entry) => {
      const name = path.join(directory, entry.name)
      return entry.isDirectory()
        ? filesIn(name)
        : /\.(?:css|[cm]?[jt]sx?)$/.test(name)
          ? [name]
          : []
    }),
  )
  return lists.flat().sort()
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const files =
    process.argv.length > 2
      ? process.argv.slice(2).map((name) => path.resolve(name))
      : (await filesIn(path.join(root, 'src'))).filter((file) =>
          file.split(path.sep).includes('client'),
        )
  const errors = (
    await Promise.all(
      files.map(async (file) => {
        const relative = path.relative(root, file).split(path.sep).join('/')
        const source = await readFile(file, 'utf8')
        return file.endsWith('.css') ? checkCss(source, relative) : checkSource(source, relative)
      }),
    )
  ).flat()
  for (const error of errors) console.error(error)
  if (errors.length) process.exitCode = 1
  else console.log(`UI 契约检查通过：${files.length} 个文件，DSH ${contract.baseline.version}`)
}
