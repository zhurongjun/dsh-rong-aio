/** 从模型插槽操作选择器，观察宿主会话、速度接口与团队投影。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act } from 'react'
import { createStore } from 'zustand/vanilla'
import TeamService from '@deepseek-ai/dsh-agent-team'
import { runtime } from './helpers/runtime.mjs'
import { mountClient, document, window, click, key, byText, waitFor } from './helpers/browser.mjs'

const trigger = () => document.querySelector('button[aria-label^="选择模型与推理强度"]')
const slider = () => document.querySelector('[role="slider"]')
const speed = () => document.querySelector('button[aria-label^="速度："]')
const team = () => document.querySelector('button[aria-label^="Agent Team："]')

// ModelDirectory 提供目录订阅和选模命令，选择结果来自真实的宿主会话。
async function mountSelector(host, agentTeams) {
  const catalog = await host.ctx.llm.listModels(host.route.provider)
  const efforts = ['off', 'medium', 'high'].map((id) => ({ id, name: id }))
  const models = catalog.map((model) =>
    model.id === host.route.model ? { ...model, reasoning: { efforts } } : model,
  )
  const directories = new Map()
  const directoryFor = (id) => {
    if (directories.has(id)) return directories.get(id)
    const agent = host.ctx.agents.get(id)
    const store = createStore(() => ({
      current: agent.model.current(),
      groups: [{ id: host.route.provider, name: 'Fixture', models }],
      pending: null,
      failures: [],
      error: null,
      status: 'ready',
    }))
    const directory = {
      store: { getSnapshot: store.getState, subscribe: store.subscribe },
      load: async () => {},
      select: async (selection) => {
        store.setState({ pending: selection })
        try {
          await host.ctx.sessionController.selectModel({ sessionId: id, ...selection })
          store.setState({ current: agent.model.current() })
          return { ok: true }
        } catch (error) {
          return { ok: false, error: { message: error.message } }
        } finally {
          store.setState({ pending: null })
        }
      },
    }
    directories.set(id, directory)
    return directory
  }
  const render = await mountClient(host, 'model-selector', {
    modelDirectories: { directoryFor },
    sessions: { subagentAddress: () => undefined },
    remote: { agentTeams },
  })
  return (agent) =>
    render('conversation.input.model', {
      sessionId: agent.id,
      locked: false,
      useProjection: (name) => host.ctx.sessionProjections.snapshot(agent.session).values[name],
      useSessions: (select) => select({ byId: { [agent.id]: agent.session.header } }),
      useSession: (select) => select({ subagent: null }),
    })
}

test('调整推理强度、键盘切换模型；选模被拒绝时保留已确认模型', async (t) => {
  const f = await runtime(t)
  const render = await mountSelector(f)
  await render(f.agent)
  await click(trigger())
  assert.equal(slider().getAttribute('aria-valuetext'), '尚未选择强度')
  const track = slider()
  track.getBoundingClientRect = () => ({ left: 0, width: 260 })
  const pointer = (type) =>
    act(async () => {
      const event = new window.MouseEvent(type, { bubbles: true, clientX: 259, button: 0 })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      track.dispatchEvent(event)
    })
  await pointer('pointerdown')
  assert.equal(track.getAttribute('aria-valuetext'), 'high')
  assert.equal(f.agent.model.current().reasoningEffort, undefined)
  await pointer('pointerup')
  assert.equal(f.agent.model.current().reasoningEffort, 'high')
  await click(document.querySelector('[aria-label="重置当前模型的推理强度"]'))
  assert.equal(f.agent.model.current().reasoningEffort, 'medium')

  const openList = async () => {
    const heading = [...document.querySelectorAll('[role="dialog"] button')].find((button) =>
      button.textContent.includes(f.agent.model.current().model),
    )
    await click(heading)
  }
  assert.equal(
    (
      await f.injectRequest({
        type: 'select',
        sessionId: f.agent.id,
        state: { name: f.prompt.name },
      })
    ).status,
    200,
  )
  await openList()
  await click(byText('[role="option"]', 'denied'))
  await waitFor(() => document.body.textContent.includes('未获破甲模式授权'), '宿主拒绝应显示提示')
  assert.equal(f.agent.model.current().model, f.route.model)
  assert.match(trigger().textContent, /gpt-6-astra/)
  assert.equal(
    (await f.injectRequest({ type: 'select', sessionId: f.agent.id, state: { name: null } }))
      .status,
    200,
  )
  const search = document.querySelector('[role="combobox"]')
  if (
    document.getElementById(search.getAttribute('aria-activedescendant'))?.textContent !== 'denied'
  )
    await key(search, 'ArrowDown')
  assert.equal(
    document.getElementById(search.getAttribute('aria-activedescendant')).textContent,
    'denied',
  )
  await key(search, 'Enter')
  await waitFor(
    () => f.agent.model.current().model === 'denied' && !slider(),
    '确认新模型后更新输入框',
  )
  assert.equal(slider(), null)
})

test('键盘设置 Fast 后，速度按会话保存，新会话仍使用标准速度', async (t) => {
  const f = await runtime(t)
  const render = await mountSelector(f)
  await render(f.agent)
  await click(trigger())
  await waitFor(() => speed() && !speed().getAttribute('aria-busy'), '速度列表应就绪')
  await click(speed())
  await key(document.activeElement, 'End')
  assert.equal(document.activeElement.textContent, '超快')
  await click(document.activeElement)
  await waitFor(
    () => trigger().getAttribute('aria-label').includes('超快模式'),
    '确认速度后更新输入框',
  )
  const read = async (sessionId) => {
    const response = await f.request(
      'rong-aio.speed?' + new URLSearchParams({ sessionId, ...f.route }),
    )
    return (await response.json()).mode
  }
  assert.equal(await read(f.agent.id), 'ultrafast')
  const { agent: other } = await f.ctx.agents.create({
    sessionId: 'another',
    agentOptions: f.route,
  })
  await render(other)
  assert.doesNotMatch(trigger().getAttribute('aria-label'), /超快模式/)
  assert.equal(await read(other.id), 'standard')
})

test('从根会话启用 Agent Team，有请求历史时关闭需确认，子会话隐藏团队开关', async (t) => {
  const f = await runtime(t)
  f.ctx.provide('subagents', {
    rootOf: (agent) =>
      agent.session.header.parentSession
        ? f.ctx.agents.get(agent.session.header.parentSession)
        : agent,
  })
  await f.ctx.plugin(TeamService)
  const render = await mountSelector(f, {
    setEnabled: async (id, enabled) => {
      await f.ctx.agentTeams.setEnabled(f.ctx.agents.get(id), enabled)
      return { ok: true }
    },
  })
  const enabled = () => f.ctx.sessionProjections.snapshot(f.agent.session).values.agentTeam.enabled
  const choose = async (label) => {
    await click(team())
    await click(byText('[role="menuitemradio"]', label))
  }
  await render(f.agent)
  await click(trigger())
  await choose('开启')
  await waitFor(
    () => enabled() && team()?.getAttribute('aria-busy') !== 'true',
    '开启团队命令应完成',
  )
  await act(async () => assert.deepEqual(await f.run(), { kind: 'completed' }))
  await render(f.agent)
  await choose('关闭')
  await click(byText('button', '取消'))
  assert.equal(enabled(), true)
  await click(trigger())
  await choose('关闭')
  await click(byText('button', '确认停用'))
  await waitFor(
    () => !document.querySelector('[aria-label="确认停用 Agent Team？"]'),
    '保存成功后关闭确认窗口',
  )
  assert.equal(enabled(), false)
  const { agent: child } = await f.ctx.agents.create({
    sessionId: 'team-child',
    agentOptions: f.route,
    meta: { cwd: f.workspace, parentSession: f.agent.id, origin: 'subagent' },
  })
  await render(child)
  await click(trigger())
  assert.equal(team(), null)
  await waitFor(() => speed() && !speed().getAttribute('aria-busy'), '子会话仍可使用速度控件')
})
