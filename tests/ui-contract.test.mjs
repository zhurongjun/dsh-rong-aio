/** UI 契约正反例：颜色语法、token、精确例外、主题所有权与源码静态样式。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCss, checkSource, contract } from '../scripts/check-ui-contract.mjs'

const file = 'src/components/model-selector/client/model-selector/styles.css'

/** 断言 CSS 正例没有任何契约诊断。 */
const valid = (source) => assert.deepEqual(checkCss(source, file), [])

/** 断言 CSS 反例包含指定错误，保留完整诊断便于失败定位。 */
const invalid = (source, pattern) => assert.match(checkCss(source, file).join('\n'), pattern)

test('UI 契约：语义 token、组件布局、字符串和 URL 不误报', () => {
  valid(`.test { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, currentColor 20%, transparent);
    width: calc(14px + var(--rong-position) * 20px); border-radius: 50%;
    content: "red #fff var(--dsw-unknown)"; background-image: url("asset.svg#white"); animation: red 1s; }
    /* color: red */ @media (prefers-reduced-motion: reduce) { .test { animation: none } }`)
})

test('UI 契约：包括 fallback、嵌套函数与 CSS 转义的具体颜色都被阻止', () => {
  for (const color of [
    '#fff',
    'red',
    'CanvasText',
    'rgb(0 0 0 / .1)',
    'hsl(0 0% 0%)',
    'oklch(50% .1 30)',
    'var(--rong-color, #fff)',
    'color-mix(in srgb, var(--dsw-alias-label-primary), white)',
    String.raw`r\65 d`,
  ])
    invalid(`.test { color: ${color} }`, /硬编码颜色/)
  invalid('.test { color: var(--dsw-typo, currentColor) }', /未登记/)
  invalid('.test { COLOR: red }', /硬编码颜色/)
  invalid('.test { color: var(--dsw-static-neutral-bluish-600) }', /未登记/)
})

test('UI 契约：主题由宿主管理，官方 namespace 不可自行重定义', () => {
  invalid(':root { --dsw-radius-lg: 17px }', /不允许重定义/)
  invalid('.test { --dsw-menu-surface-fill: transparent }', /不允许重定义/)
  invalid('.test { --dsw-menu-backdrop-filter: blur(20px) }', /不允许重定义/)
  invalid('.test { color: light-dark(currentColor, transparent) }', /分支明暗/)
  invalid('@media (prefers-color-scheme: dark) { .test { color: currentColor } }', /继承 DSH token/)
  invalid('[data-ds-dark-theme] .test { color: currentColor }', /继承 DSH token/)
  invalid('.test { color-scheme: dark }', /宿主管理/)
})

test('UI 契约：合法局部重绑与装饰只能在登记的精确范围生效', () => {
  for (const entry of [...contract.localBindings, ...contract.decorations]) {
    assert.ok(entry.reason)
    const source = `${entry.selector} { ${entry.property}: ${entry.value} }`
    valid(source)
    assert.ok(checkCss(source, 'src/components/model-selector/client/elsewhere.css').length)
    invalid(`.elsewhere { ${entry.property}: ${entry.value} }`, /硬编码颜色|不允许重定义/)
    invalid(`@media (min-width: 1px) { ${source} }`, /硬编码颜色|不允许重定义/)
  }
  invalid('.rong-effort-thumb { background: #eee }', /硬编码颜色/)
  invalid('.rong-model-popover { --dsw-elevation-stroke-color: currentColor }', /不允许重定义/)
  invalid('.rong-effort-thumb, .other { background: #fff }', /硬编码颜色/)
  invalid('.other { .rong-effort-thumb { background: #fff } }', /硬编码颜色|无法解析/)
})

test('UI 契约：TSX/SVG 与 DOM 样式同样受约束，运动数字不误报', () => {
  assert.deepEqual(
    checkSource(
      `const Icon = () => <svg fill={active ? 'none' : 'currentColor'} stroke="currentColor"
    style={{color: 'var(--dsw-alias-label-primary)', '--rong-position': position,
      border: 0, borderRadius: 8, borderWidth: size, backgroundPosition: position}} />;
    node.style.setProperty('--rong-position', String(position)); node.style.top = y + '%';`,
      'src/components/model-selector/client/test.tsx',
    ),
    [],
  )
  for (const source of [
    'const Icon = () => <svg fill={active ? "currentColor" : "red"} />',
    'const view = <div style={{ backgroundColor: "#fff" }} />',
    'const view = <div style={{ fontSize: "var(--dsw-typo)" }} />',
    'node.style.color = "rgb(0 0 0)"',
    'node.style["background"] = "white"',
    'node.style.setProperty("--dsw-radius-lg", "17px")',
    'node.setAttribute("fill", "red")',
    'node.style.cssText = "color: red"',
    'node.setAttribute("style", "color: red")',
    'const view = <div style={{ color: palette.custom }} />',
    'const view = <div style={{ colorScheme: "light" }} />',
    'window.matchMedia("(prefers-color-scheme: dark)")',
  ])
    assert.ok(checkSource(source, 'src/components/model-selector/client/test.tsx').length, source)
})

test('UI 契约：解析错误直接失败，消费清单与固定官方来源绑定', () => {
  invalid('.test { color: rgb( }', /无法解析/)
  assert.ok(
    checkSource('const broken = <div', 'src/components/model-selector/client/test.tsx').length,
  )
  assert.match(contract.baseline.commit, /^[0-9a-f]{40}$/)
  assert.ok(contract.baseline.sourceBase.includes(contract.baseline.commit))
  for (const [name, entry] of Object.entries(contract.tokens)) {
    assert.match(name, /^--(?:dsw|dsh|ds)-/)
    assert.doesNotMatch(name, /^--dsw-static-/)
    assert.match(entry.source, /^packages\/client\/.+#L\d+$/)
    assert.ok(entry.role)
  }
})
