import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { checkCssImports, checkImports } from '../../tools/lint/boundaries.ts'
import { checkCss, checkSource } from '../../tools/lint/ui-contract.ts'
import { loadWorkspaceManifests } from '../../tools/manifest.ts'

const cssFile = 'src/components/fixture/client/example.css'
const validCss = (source: string) => assert.deepEqual(checkCss(source, cssFile), [])
const invalidCss = (source: string, pattern: RegExp) =>
  assert.match(checkCss(source, cssFile).join('\n'), pattern)

test('组件边界：允许组件内和根 Shared，阻止跨组件、跨侧及规范化路径绕过', () => {
  const file = 'src/components/first/client/index.ts'
  for (const value of [
    '../shared/rules.ts',
    '../../../shared/protocol.ts',
    '../../../client/http.ts',
    './view.tsx',
  ]) {
    assert.deepEqual(checkImports(`import '${value}'`, file), [])
  }
  for (const source of [
    "import '../../second/client/view.ts'",
    "export * from '../../second/shared/rules.ts'",
    "const view = import('../../second/client/view.ts')",
    "type T = import('../../second/shared/types.ts').T",
    "import '../shared/../host/index.ts'",
    "import '../../../host/session-spill.ts'",
    "import '../../../runtime/host/component.ts'",
    "import 'dsh-rong-aio/second'",
    'const view = import(path)',
  ]) {
    assert.ok(checkImports(source, file).length, source)
  }

  const hostFile = 'src/components/first/host/index.ts'
  assert.deepEqual(checkImports("import '../../../host/session-spill.ts'", hostFile), [])
  assert.ok(checkImports("import '../../../client/http.ts'", hostFile).length)

  assert.ok(
    checkImports("import '../components/first/shared/rules.ts'", 'src/shared/index.ts').length,
  )
  assert.ok(
    checkImports("import '../components/first/shared/rules.ts'", 'src/client/http.ts').length,
  )
  assert.ok(
    checkImports("import '../components/first/shared/rules.ts'", 'src/host/session-spill.ts')
      .length,
  )
  assert.ok(
    checkImports("export * from '../client/view.ts'", 'src/components/first/shared/index.ts')
      .length,
  )
  assert.ok(checkImports("import '../client/view.ts'", 'src/runtime/host/index.ts').length)
})

test('CSS 导入边界：允许组件内及根客户端相对导入，阻止跨组件、跨侧及包名绕过', () => {
  const file = 'src/components/first/client/styles.css'
  for (const source of [
    "@import './tokens.css';",
    "@import '../shared/theme.css';",
    "@import '../../../client/base.css';",
    '@import url("./tokens.css");',
  ]) {
    assert.deepEqual(checkCssImports(source, file), [], source)
  }

  for (const source of [
    "@import '../../second/client/styles.css';",
    '@import url("../../second/client/styles.css");',
    "@import '../host/styles.css';",
    "@import 'dsh-rong-aio/second';",
  ]) {
    assert.ok(checkCssImports(source, file).length, source)
  }
})

test('UI 契约：语义 token、组件布局、字符串和 URL 不误报', () => {
  validCss(`.test { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, currentColor 20%, transparent);
    width: calc(14px + var(--rong-position) * 20px); border-radius: 50%;
    content: "red #fff var(--dsw-unknown)"; background-image: url("asset.svg#white"); animation: red 1s; }
    /* color: red */ @media (prefers-reduced-motion: reduce) { .test { animation: none } }`)
})

test('UI 契约：直接写入、回退值及混色中的固定颜色均报告错误', () => {
  for (const color of [
    '#fff',
    'var(--rong-color, #fff)',
    'color-mix(in srgb, currentColor, white)',
  ]) {
    invalidCss(`.test { color: ${color} }`, /禁止硬编码颜色/)
  }
  invalidCss('.test { color: var(--dsw-typo, currentColor) }', /未登记的宿主 token/)
})

test('UI 契约：主题由宿主管理，官方 namespace 不可自行重定义', () => {
  invalidCss('.test { --dsw-menu-surface-fill: transparent }', /禁止重定义宿主变量/)
  invalidCss(
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
  ]) {
    assert.ok(checkSource(source, 'src/components/fixture/client/example.tsx').length, source)
  }
})

test('UI 契约：无法解析的输入报告错误', () => {
  invalidCss('.test { color: rgb( }', /无法解析/)
  assert.ok(checkSource('const broken = <div', 'src/components/fixture/client/example.tsx').length)
})

test('工程清单校验：真实仓库通过，子组件版本不一致或 cordis.patch.yml 漏配时拒绝', async (t) => {
  const real = await loadWorkspaceManifests()
  assert.equal(real.components.length, 4)

  await mkdir('agent_temp/tests', { recursive: true })
  const dir = await mkdtemp(resolve('agent_temp/tests/manifest-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  await mkdir(join(dir, 'src/components/demo/host'), { recursive: true })
  await writeFile(join(dir, 'src/components/demo/host/index.ts'), 'export {}\n')
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'demo-pkg',
      version: '1.0.0',
      keywords: ['dsh-plugin'],
      exports: {
        './demo': { types: './lib/demo.d.ts', default: './lib/demo.js' },
        './demo/locale/*.json': './lib/components/demo/locale/*.json',
      },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  )

  const writeComponent = (version: string) =>
    writeFile(
      join(dir, 'src/components/demo/package.json'),
      JSON.stringify({
        name: 'demo-pkg-demo',
        version,
        private: true,
        type: 'module',
      }),
    )

  await writeComponent('0.9.9')
  await writeFile(
    join(dir, 'cordis.patch.yml'),
    '- insert:\n    - id: rong-aio-demo\n      name: demo-pkg/demo\n',
  )
  await assert.rejects(loadWorkspaceManifests(dir), /版本/)

  await writeComponent('1.0.0')
  await writeFile(join(dir, 'cordis.patch.yml'), '- insert: []\n')
  await assert.rejects(loadWorkspaceManifests(dir), /cordis\.patch\.yml/)

  await writeFile(
    join(dir, 'cordis.patch.yml'),
    '- insert:\n    - id: rong-aio-demo\n      name: demo-pkg/demo\n',
  )
  const loaded = await loadWorkspaceManifests(dir)
  assert.equal(loaded.components[0].id, 'demo')
})
