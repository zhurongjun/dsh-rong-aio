import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCssImports, checkImports } from '../../tools/lint/boundaries.ts'

test('组件边界：允许组件内和根 Shared，阻止跨组件、跨侧及规范化路径绕过', () => {
  const file = 'src/components/first/client/index.ts'
  for (const value of [
    '../shared/rules.ts',
    '../../../shared/protocol.ts',
    '../../../client/http.ts',
    './view.tsx',
  ])
    assert.deepEqual(checkImports(`import '${value}'`, file), [])
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
  ])
    assert.ok(checkImports(source, file).length, source)

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
