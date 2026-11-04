import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkImports } from '../scripts/check-boundaries.mjs'

test('组件边界：允许组件内和根 Shared，阻止跨组件、跨侧及规范化路径绕过', () => {
  const file = 'src/components/first/client/index.ts'
  for (const value of ['../shared/rules.ts', '../../../shared/protocol.ts', './view.tsx'])
    assert.deepEqual(checkImports(`import '${value}'`, file), [])
  for (const source of [
    "import '../../second/client/view.ts'",
    "export * from '../../second/shared/rules.ts'",
    "const view = import('../../second/client/view.ts')",
    "type T = import('../../second/shared/types.ts').T",
    "import '../shared/../host/index.ts'",
    "import '../../../runtime/host/component.ts'",
    "import 'dsh-rong-aio/second'",
    'const view = import(path)',
  ])
    assert.ok(checkImports(source, file).length, source)
  assert.ok(
    checkImports("import '../components/first/shared/rules.ts'", 'src/shared/index.ts').length,
  )
  assert.ok(
    checkImports("export * from '../client/view.ts'", 'src/components/first/shared/index.ts')
      .length,
  )
  assert.ok(checkImports("import '../client/view.ts'", 'src/runtime/host/index.ts').length)
})
