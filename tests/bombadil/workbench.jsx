import React, { useState } from 'react'
import * as ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { createStore } from 'zustand/vanilla'
import * as primitives from './primitives.mjs'
import '../../node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '../../node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'

const modules = {
  react: React,
  'react-dom': ReactDOM,
  'react/jsx-runtime': jsxRuntime,
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
}
const slots = new Map()
const directories = new Map()
async function command(action, args = {}) {
  const response = await fetch('/fixture', {
    method: 'POST',
    body: JSON.stringify({ action, ...args }),
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

async function start() {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      async writeText(value) {
        document.querySelector('output[aria-label="测试剪贴板"]').textContent = value
      },
    },
  })
  const { models, sessions } = await command('catalog')
  for (const session of sessions) {
    const store = createStore(() => ({
      current: session.current,
      groups: [{ id: 'fixture', name: 'Fixture', models }],
      pending: null,
      failures: [],
      error: null,
      status: 'ready',
    }))
    directories.set(session.id, {
      store: { getSnapshot: store.getState, subscribe: store.subscribe },
      load: async () => {},
      async select(selection) {
        store.setState({ pending: selection })
        const requests = document.querySelector('output[aria-label="宿主选模记录"]')
        requests.textContent = selection.reasoningEffort ?? selection.model
        try {
          const current = await command('model', { id: session.id, selection })
          store.setState({ current })
          return { ok: true }
        } catch (error) {
          return { ok: false, error: { message: error.message } }
        } finally {
          store.setState({ pending: null })
        }
      },
    })
  }
  const sidebar = document.querySelector('aside')
  const refreshSidebar = async () => {
    sidebar.textContent = (await command('sidebar')).join(' ')
  }
  let refreshProjection
  const services = {
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) =>
        slots.set(options.id && options.name === 'settings.section' ? options.id : options.name, {
          options,
          component,
        }),
    },
    inject: (names, fn) => {
      if (names.every((name) => name.split('.').reduce((v, k) => v?.[k], services))) fn(services)
    },
    effect: (setup) => setup(),
    conversation: { blocks: { set() {} } },
    sessions: { subagentAddress: () => undefined, refresh: refreshSidebar },
    modelDirectories: { directoryFor: (id) => directories.get(id) },
    remote: {
      agentTeams: {
        async setEnabled(id, enabled) {
          await command('team', { id, enabled })
          await refreshProjection(id)
          return { ok: true }
        },
      },
    },
  }
  window.__ModuleLoader__ = {
    load: ({ factory }) =>
      factory((dep) => {
        if (!(dep in modules)) throw new Error('Missing host module ' + dep)
        return modules[dep]
      }).apply(services),
  }
  for (const name of ['model-selector', 'system-inject', 'session-manager'])
    await import('/client/' + name + '.js')
  function Slot({ name, id, info }) {
    const { options, component: Component } = slots.get(name)
    return (
      <Component
        {...options.inject?.(id)}
        sessionId={id}
        locked={false}
        useProjection={(key) => info.projections[key]}
        useSession={(select) => select({ subagent: null })}
        useSessions={(select) => select({ byId: { [id]: info.header } })}
      />
    )
  }
  function Workbench() {
    const [section, setSection] = useState('conversation')
    const [info, setInfo] = useState(sessions[0])
    refreshProjection = async (id) => setInfo(await command('snapshot', { id }))
    return (
      <>
        <nav aria-label="测试宿主导航">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={async () => {
                await refreshProjection(s.id)
                setSection('conversation')
              }}
            >
              {s.id}
            </button>
          ))}
          <button onClick={() => setSection('rong-aio-system-inject')}>破甲设置</button>
          <button onClick={() => setSection('rong-aio-session-manager')}>会话管理</button>
          <button
            onClick={async () => {
              await command('turn', { id: info.id })
              await refreshProjection(info.id)
              window.dispatchEvent(new Event('focus'))
            }}
          >
            发送测试消息
          </button>
        </nav>
        {section === 'conversation' ? (
          <section key={info.id} aria-label={info.id}>
            <Slot name="conversation.input.left" id={info.id} info={info} />
            <Slot name="conversation.input.model" id={info.id} info={info} />
          </section>
        ) : (
          <Slot key={section} name={section} id={info.id} info={info} />
        )}
      </>
    )
  }
  createRoot(document.querySelector('main')).render(<Workbench />)
}
start().catch((error) => {
  document.querySelector('main').textContent = error.stack
  throw error
})
