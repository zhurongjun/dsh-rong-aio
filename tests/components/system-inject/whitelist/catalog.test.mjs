/** 验证模型目录展示名称与实际授权标识的区分。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostFixture } from '../helpers/host.mjs'

test('模型目录名称仅作展示，白名单仍只保存精确提供商与模型标识', async (t) => {
  const f = await hostFixture(t)
  f.ctx.llm.listProviders = () => [{ id: 'fixture', name: '测试提供商' }]
  f.ctx.llm.listModels = async () => [{ id: 'allowed', name: '测试模型' }]
  const view = await f.api(undefined, '')
  assert.deepEqual(view.routes, [
    {
      provider: 'fixture',
      model: 'allowed',
      providerName: '测试提供商',
      modelName: '测试模型',
    },
  ])
  await f.api({ type: 'whitelist', routes: [f.route, f.route] })
  assert.deepEqual((await f.api(undefined, '')).config.whitelist, [f.route])
})
