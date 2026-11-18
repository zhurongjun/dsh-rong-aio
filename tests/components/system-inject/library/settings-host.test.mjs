/** 真实宿主的用户与工程模板编辑范围。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostFixture } from '../helpers/host.mjs'

test('全局设置只返回用户库，输入框项目设置合并两层，缺少项目上下文不能写入项目', async (t) => {
  const f = await hostFixture(t)
  const projectPrompt = { ...f.prompt, name: 'project', display_name: '项目词' }
  await f.put(projectPrompt, 'workspace')
  const global = await f.api(undefined, '')
  assert.deepEqual(
    global.config.templates.map((item) => item.scope),
    ['user'],
  )
  const url =
    'http://fixture/api/rong-aio.system-inject?workspace=' + encodeURIComponent(f.workspace)
  const project = await (await f.endpoint().fetch(new Request(url))).json()
  assert.deepEqual(
    project.config.templates.map((item) => item.scope),
    ['user', 'workspace'],
  )
  assert.equal(project.config.workspace, f.workspace)
  assert.equal('workspaces' in project, false)
  const rejected = await f.endpoint().fetch(
    new Request('http://fixture/api/rong-aio.system-inject', {
      method: 'POST',
      body: JSON.stringify({
        type: 'save-template',
        revision: global.config.revision,
        scope: 'workspace',
        template: { ...projectPrompt, name: 'another' },
      }),
    }),
  )
  assert.equal(rejected.status, 409)
  assert.match((await rejected.json()).error, /工作区/)
})
