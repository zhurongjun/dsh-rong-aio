import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { sessionDirectory } from '../../src/host/session-location.ts'

test('sessionDirectory：规范编码工作区路径、无 cwd 与特殊会话 ID 边界', () => {
  const root = '/tmp/sessions'

  assert.equal(
    sessionDirectory(root, { id: 'abc-123', cwd: '/Users/dev/project' }),
    join(root, '--Users-dev-project--', 'abc-123'),
  )
  assert.equal(
    sessionDirectory(root, { id: 's1', cwd: 'C:\\work\\app' }),
    join(root, '--C-work-app--', 's1'),
  )
  assert.equal(sessionDirectory(root, { id: 's2' }), join(root, '_no-cwd', 's2'))
  assert.equal(
    sessionDirectory(root, { id: 'a:b/c', cwd: '/' }),
    join(root, '--root--', 'a~003Ab~002Fc'),
  )
  assert.equal(sessionDirectory(root, { id: '.', cwd: '/work' }), join(root, '--work--', '~002E'))
  assert.equal(
    sessionDirectory(root, { id: '..', cwd: '/work' }),
    join(root, '--work--', '~002E~002E'),
  )

  assert.throws(() => sessionDirectory(root, { id: '', cwd: '/work' }), /会话 ID/)
  assert.throws(() => sessionDirectory(root, { id: 's3', cwd: '' }), /工作区路径/)
})
