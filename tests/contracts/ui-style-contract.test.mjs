import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCss, checkSource } from '../../tools/lint/ui-contract.ts'

const file = 'src/components/fixture/client/example.css'

const valid = (source) => assert.deepEqual(checkCss(source, file), [])

const invalid = (source, pattern) => assert.match(checkCss(source, file).join('\n'), pattern)

test('UI 契约：语义 token、组件布局、字符串和 URL 不误报', () => {
  valid(`.test { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, currentColor 20%, transparent);
    width: calc(14px + var(--rong-position) * 20px); border-radius: 50%;
    content: "red #fff var(--dsw-unknown)"; background-image: url("asset.svg#white"); animation: red 1s; }
    /* color: red */ @media (prefers-reduced-motion: reduce) { .test { animation: none } }`)
})

test('UI 契约：直接写入、回退值及混色中的固定颜色均报告错误', () => {
  for (const color of [
    '#fff',
    'var(--rong-color, #fff)',
    'color-mix(in srgb, currentColor, white)',
  ])
    invalid(`.test { color: ${color} }`, /禁止硬编码颜色/)
  invalid('.test { color: var(--dsw-typo, currentColor) }', /未登记的宿主 token/)
})

test('UI 契约：主题由宿主管理，官方 namespace 不可自行重定义', () => {
  invalid('.test { --dsw-menu-surface-fill: transparent }', /禁止重定义宿主变量/)
  invalid(
    '@media (prefers-color-scheme: dark) { .test { color: currentColor } }',
    /明暗主题媒体查询/,
  )
})

test('UI 契约：TSX/SVG 与 DOM 样式同样受约束，运动数字不误报', () => {
  assert.deepEqual(
    checkSource(
      `const Icon = () => <svg fill={active ? 'none' : 'currentColor'} stroke="currentColor"
    style={{color: 'var(--dsw-alias-label-primary)', '--rong-position': position,
      border: 0, borderRadius: 8, borderWidth: size, backgroundPosition: position}} />;
    node.style.setProperty('--rong-position', String(position)); node.style.top = y + '%';`,
      'src/components/fixture/client/example.tsx',
    ),
    [],
  )
  for (const source of [
    'const Icon = () => <svg fill={active ? "currentColor" : "red"} />',
    'const view = <div style={{ backgroundColor: "#fff" }} />',
    'node.style.setProperty("--dsw-radius-lg", "17px")',
  ])
    assert.ok(checkSource(source, 'src/components/fixture/client/example.tsx').length, source)
})

test('UI 契约：无法解析的输入报告错误', () => {
  invalid('.test { color: rgb( }', /无法解析/)
  assert.ok(checkSource('const broken = <div', 'src/components/fixture/client/example.tsx').length)
})
