/** 输入框与设置均从 DSH 注册的入口访问实际宿主。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act } from 'react'
import { runtime } from './helpers/runtime.mjs'
import { mountClient, document, window, click, byText, waitFor } from './helpers/browser.mjs'

const mount = (host) =>
  mountClient(host, 'system-inject', {
    sessions: { subagentAddress: () => undefined },
    conversation: { blocks: { set() {} } },
  })

test('输入框选词遇到未授权模型显示拒绝提示，换回授权模型后可选词并查看冻结正文', async (t) => {
  const f = await runtime(t)
  const render = await mount(f)
  const trigger = () => document.querySelector('button[aria-label^="破甲模式："]')
  const option = () =>
    [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent.includes(f.prompt.display_name),
    )
  const selectModel = (model) =>
    f.ctx.sessionController.selectModel({
      sessionId: f.agent.id,
      provider: f.route.provider,
      model,
    })
  const choose = async () => {
    await click(trigger())
    await waitFor(() => option() && !option().disabled)
    await click(option())
  }

  await selectModel('denied')
  await render('conversation.input.left', { sessionId: f.agent.id })
  await choose()
  await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('denied'))
  assert.equal(trigger().getAttribute('aria-label'), '破甲模式：未破甲')
  assert.equal(document.querySelector('[role="dialog"]'), null)
  await click(document.querySelector('[aria-label="关闭通知"]'))
  await selectModel(f.route.model)
  await choose()
  await waitFor(() => trigger()?.textContent.includes(f.prompt.display_name))
  await assert.rejects(selectModel('denied'), /未获/)
  assert.equal(document.querySelector('[role="status"]'), null)

  assert.deepEqual(await f.run(), { kind: 'completed' })
  await act(async () => window.dispatchEvent(new window.Event('focus')))
  await waitFor(() => trigger()?.getAttribute('aria-haspopup') === 'dialog')
  await click(trigger())
  const body = document.querySelector('[aria-label="破甲模式正文快照"]')
  assert.equal(body.value, f.prompt.body)
  assert.ok(body.readOnly)
})

test('在全局设置中查看模板正文，新增并移除模型授权', async (t) => {
  const f = await runtime(t)
  const render = await mount(f)
  await render('settings.section')
  const edit = () => document.querySelector('button[aria-label^="编辑破甲词"]')
  await waitFor(edit, '模板库应显示已有模板')
  await click(edit())
  assert.equal(document.querySelector('textarea').value, f.prompt.body)
  await click(document.querySelector('[aria-label="返回模板库"]'))
  await click(byText('[role="tab"]', '模型白名单'))
  await click(byText('button', '新增'))
  const options = [...document.querySelectorAll('[role="option"]')]
  const allowed = options.find((item) => item.textContent.includes(f.route.model))
  assert.ok(allowed, '已授权的模型仍应出现在模型目录中')
  assert.ok(allowed.disabled)
  await click(options.find((item) => item.textContent.includes('denied')))
  const remove = () => document.querySelector('button[aria-label^="删除 denied"]')
  await waitFor(remove, '设置页应显示新授权')
  assert.ok((await f.injectView()).config.whitelist.some((item) => item.model === 'denied'))
  await click(remove())
  await waitFor(() => !remove(), '删除后列表应更新')
  assert.deepEqual((await f.injectView()).config.whitelist, [f.route])
})
