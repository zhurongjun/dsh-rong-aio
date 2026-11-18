/** Team 开关、确认提示与原生输入框插槽。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { act } from 'react'
import { createRoot, ModelSelector, models, loadModelClient } from '../helpers/dom.mjs'

test('Team 与 Fast 共用菜单：确认值、重复提交保护、失败 Toast 与已有请求关闭确认', async () => {
  globalThis.fetch = async () => Response.json({ mode: 'standard', modes: ['standard', 'fast'] })
  const state = {
    current: { provider: 'p', model: 'first' },
    groups: [{ id: 'p', name: 'P', models }],
    failures: [],
    pending: null,
    status: 'ready',
    error: null,
  }
  const root = createRoot(document.getElementById('root'))
  let enabled = false
  let needsConfirmation = false
  let locked = false
  let sessionId = 'team'
  const calls = []
  let response
  const render = () =>
    root.render(
      React.createElement(ModelSelector, {
        sessionId,
        available: true,
        locked,
        directory: { getSnapshot: () => state, subscribe: () => () => {} },
        load() {},
        select() {
          throw Error('Team 不得调用选模')
        },
        team: {
          enabled,
          ready: true,
          needsConfirmation,
          selectEnabled(value) {
            calls.push(value)
            response = Promise.withResolvers()
            return response.promise
          },
        },
      }),
    )
  const click = (element) => act(async () => element.click())
  const choose = async (label) => {
    await click(document.querySelector('.rong-team'))
    assert.equal(
      document.querySelector('[role="menu"]').getAttribute('aria-label'),
      'Agent Team 模式',
    )
    await click(
      [...document.querySelectorAll('[role="menuitemradio"]')].find(
        (item) => item.textContent === label,
      ),
    )
  }
  const button = (label) =>
    [...document.querySelectorAll('button')].find((item) => item.textContent === label)
  try {
    await act(async () => render())
    await click(document.querySelector('.rong-model-trigger'))
    assert.equal(
      document.querySelector('.rong-fast').nextElementSibling,
      document.querySelector('.rong-team'),
    )
    await choose('开启')
    assert.deepEqual(calls, [true])
    assert.equal(document.querySelector('.rong-team').getAttribute('aria-busy'), 'true')
    assert.match(document.querySelector('.rong-team').getAttribute('aria-label'), /关闭/)
    await click(document.querySelector('.rong-team'))
    assert.equal(calls.length, 1)
    await act(async () => response.resolve({ ok: false, error: { message: '拒绝' } }))
    assert.match(document.querySelector('[data-test-toast]').textContent, /拒绝/)
    assert.equal(document.querySelectorAll('[data-test-toast]').length, 1)
    await choose('开启')
    await act(async () => response.resolve({ ok: true, value: undefined }))
    assert.match(
      document.querySelector('.rong-team').getAttribute('aria-label'),
      /关闭/,
      'Remote 成功不代替投影',
    )
    enabled = true
    needsConfirmation = true
    await act(async () => render())
    assert.ok(document.querySelector('.rong-team-enabled'))
    await choose('关闭')
    assert.equal(document.querySelector('.rong-model-popover'), null)
    assert.ok(document.querySelector('[aria-label="确认停用 Agent Team？"]'))
    assert.deepEqual(calls, [true, true])
    await click(button('取消'))
    assert.equal(document.querySelector('[data-test-modal]'), null)
    assert.deepEqual(calls, [true, true])
    await click(document.querySelector('.rong-model-trigger'))
    await choose('关闭')
    await click(button('确认停用'))
    assert.deepEqual(calls, [true, true, false])
    await act(async () => response.reject(Error('断线')))
    assert.ok(document.querySelector('[data-test-modal]'))
    assert.match(document.querySelector('[data-test-toast]').textContent, /断线/)
    await click(button('确认停用'))
    await act(async () => response.resolve({ ok: true, value: undefined }))
    enabled = false
    await act(async () => render())
    assert.equal(document.querySelector('[data-test-modal]'), null)
    await click(document.querySelector('.rong-model-trigger'))
    locked = true
    await act(async () => render())
    assert.equal(document.querySelector('.rong-team').disabled, true)
    locked = false
    await act(async () => render())
    await click(document.querySelector('.rong-model-trigger'))
    await choose('开启')
    const old = response
    sessionId = 'another'
    await act(async () => render())
    await act(async () => old.reject(Error('旧会话迟到失败')))
    assert.equal(document.querySelector('[data-test-toast]'), null)
  } finally {
    await act(async () => root.unmount())
  }
})

test('原生插槽 Team 接入：可选 Remote 生命周期、根会话与投影门槛，命令固定会话', async () => {
  const cleanups = []
  const teamCleanups = []
  let capability
  let registration
  let Component
  const state = {
    current: { provider: 'p', model: 'first' },
    groups: [{ id: 'p', name: 'P', models }],
    failures: [],
    pending: null,
    status: 'ready',
    error: null,
  }
  const modelClient = await loadModelClient()
  modelClient.apply({
    effect: (effect) => cleanups.push(effect()),
    inject: (names, callback) => {
      assert.deepEqual(names, ['remote.agentTeams'])
      capability = callback
    },
    slots: {
      inject: (_name, register) => register(),
      register: (options, component) => {
        registration = options
        Component = component
      },
    },
    modelDirectories: {
      directoryFor: () => ({
        store: { getSnapshot: () => state, subscribe: () => () => {} },
        load: async () => {},
        select: async () => ({ ok: true }),
      }),
    },
    sessions: { subagentAddress: () => undefined },
  })
  const root = createRoot(document.getElementById('root'))
  let addressed = false
  let listed = false
  let mode = { enabled: false, tasks: [] }
  let model = { lastUsed: null }
  const calls = []
  const render = () =>
    root.render(
      React.createElement(Component, {
        ...registration.inject('root-session'),
        sessionId: 'root-session',
        locked: false,
        useSession: (select) => select({ subagent: addressed ? {} : null }),
        useSessions: (select) =>
          select({ byId: { 'root-session': { origin: listed ? 'subagent' : 'user' } } }),
        useProjection: (key) => (key === 'agentTeam' ? mode : model),
      }),
    )
  const click = (element) => act(async () => element.click())
  try {
    await act(async () => render())
    await click(document.querySelector('.rong-model-trigger'))
    assert.equal(document.querySelector('.rong-team'), null)
    const service = {
      setEnabled: async function (id, value) {
        assert.equal(this, service)
        calls.push([id, value])
        return { ok: true, value: undefined }
      },
    }
    await act(async () =>
      capability({
        remote: { agentTeams: service },
        effect: (effect) => teamCleanups.push(effect()),
      }),
    )
    assert.ok(document.querySelector('.rong-team'))
    assert.deepEqual(calls, [], '发布能力不能调用远程命令')
    await click(document.querySelector('.rong-team'))
    await click(
      [...document.querySelectorAll('[role="menuitemradio"]')].find(
        (item) => item.textContent === '开启',
      ),
    )
    assert.deepEqual(calls, [['root-session', true]])
    assert.match(document.querySelector('.rong-team').getAttribute('aria-label'), /关闭/)
    model = undefined
    await act(async () => render())
    assert.equal(document.querySelector('.rong-team').disabled, true)
    model = { lastUsed: null }
    addressed = true
    await act(async () => render())
    assert.equal(document.querySelector('.rong-team'), null)
    addressed = false
    listed = true
    await act(async () => render())
    assert.equal(document.querySelector('.rong-team'), null)
    listed = false
    mode = undefined
    await act(async () => render())
    assert.equal(document.querySelector('.rong-team'), null)
    mode = { enabled: true, tasks: [] }
    await act(async () => render())
    assert.ok(document.querySelector('.rong-team-enabled'))
    await act(async () => teamCleanups.forEach((cleanup) => cleanup()))
    assert.equal(document.querySelector('.rong-team'), null)
    assert.ok(document.querySelector('.rong-fast'))
  } finally {
    await act(async () => root.unmount())
    cleanups.reverse().forEach((cleanup) => cleanup?.())
  }
})
