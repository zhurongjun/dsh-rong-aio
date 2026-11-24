import React, { useState } from 'react'
import * as ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { createStore } from 'zustand/vanilla'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/src/client/index.ts'
import { CommandUiRuntime } from '@deepseek-ai/dsh-client-ui-commands/src/client/service.ts'
import * as primitives from './primitives.mjs'
import { GuideBody } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx'
import inputBar from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/InputBar.module.css'
import conversation from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css'
import '../../node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '../../node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'
import '../../node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/gradient-shadow-text.css'
import '../../node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/scrollbar.css'

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
  const infoStore = createStore(() => sessions[0])
  const refreshProjection = async (id) =>
    infoStore.setState(await command('snapshot', { id }), true)
  const sidebarTabTypes = new Map()
  const dock = createStore(() => ({ tabs: [], active: {}, expanded: true }))
  const sidebarRight = {
    mounted: { getSnapshot: () => current.getState().key },
    openTabs: { getSnapshot: () => dock.getState().tabs },
    openTab(kind, options) {
      const sessionId = current.getState().key
      const contentId =
        'sidebar://' + kind + (sidebarTabTypes.get(kind).multiple ? '/' + crypto.randomUUID() : '')
      this.place(kind, sessionId, contentId, options?.params)
    },
    openResource(contentId, { kind }) {
      if (!sidebarTabTypes.get(kind).canOpen(contentId)) throw new Error('Unclaimed resource')
      this.place(kind, current.getState().key, contentId)
    },
    place(kind, sessionId, contentId, params) {
      const existing = dock
        .getState()
        .tabs.find((t) => t.sessionId === sessionId && t.contentId === contentId)
      if (existing) {
        this.focus(existing.tabId)
        return
      }
      const tabId = crypto.randomUUID()
      const t = {
        kind,
        sessionId,
        contentId,
        tabId,
        controller: new AbortController(),
        navigation: { params, revision: 1 },
      }
      dock.setState((s) => ({
        tabs: [...s.tabs, t],
        active: { ...s.active, [sessionId]: tabId },
        expanded: true,
      }))
    },
    focus(id) {
      dock.setState((s) => ({ active: { ...s.active, [current.getState().key]: id } }))
    },
    isExpanded: () => dock.getState().expanded,
    toggleExpanded() {
      dock.setState((s) => ({ expanded: !s.expanded }))
    },
    close(id) {
      this.closeIn(current.getState().key, id)
    },
    closeIn(sessionId, id) {
      const closing = dock.getState().tabs.find((t) => t.sessionId === sessionId && t.tabId === id)
      if (!closing) return
      closing.controller.abort()
      dock.setState((s) => {
        const tabs = s.tabs.filter((t) => t !== closing)
        return {
          tabs,
          active:
            s.active[sessionId] === id
              ? {
                  ...s.active,
                  [sessionId]: tabs.filter((t) => t.sessionId === sessionId).at(-1)?.tabId,
                }
              : s.active,
        }
      })
    },
  }
  const current = createStore(() => ({ key: sessions[0].id }))
  const status = { getSnapshot: () => new Map(), subscribe: () => () => {} }
  const services = {
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => {
        const key = options.name === 'settings.section' ? options.id : options.name
        const entries = slots.get(key) ?? []
        entries.push({ options, component })
        slots.set(
          key,
          entries.sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0)),
        )
      },
    },
    inject: (names, fn) => {
      if (names.every((name) => name.split('.').reduce((v, k) => v?.[k], services))) fn(services)
    },
    effect: (setup) => setup(),
    conversation: { blocks: { set() {} } },
    sessions: {
      subagentAddress: () => undefined,
      refresh: refreshSidebar,
      binding: (id) => sessions.find((row) => row.id === id),
      using: (_id, _options, callback) =>
        callback({ binding: { session: { getSnapshot: () => ({ openState: 'open' }) } } }),
      scope: () => undefined,
      list: { getSnapshot: () => ({ ids: [], byId: {} }) },
      retain: (sessionId) => ({
        sessionId,
        ready: new Promise((resolve) => setTimeout(resolve, 160)),
        release() {},
      }),
      search: async () => ({ ok: true, value: { items: [], hasMore: false } }),
    },
    uiConversation: { interactions: { register() {}, getSnapshot: () => [] } },
    uiSession: {
      sessionStatus: status,
      adapter: { current: { getSnapshot: current.getState, subscribe: current.subscribe } },
    },
    sidebarRightTabs: { register: (type) => sidebarTabTypes.set(type.kind, type) },
    sidebarRight,
    uiWorkspace: {
      openSession(id) {
        current.setState({ key: id })
        void refreshProjection(id)
      },
    },
    get: (name) => services[name],
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
  const slashContext = new Context()
  let slash
  slashContext.provide('inputTriggers', {
    registerSource(source) {
      slash = source
      return () => {}
    },
  })
  slashContext.provide('sessions', services.sessions)
  slashContext.provide('remote', {
    commands: { list: async () => ({ ok: true, value: [] }) },
    $on() {},
  })
  const locale = new LocaleRuntime(slashContext, undefined, { languages: ['zh'] })
  slashContext.provide('locale', locale)
  services.locale = locale
  services.commandUi = new CommandUiRuntime(slashContext)
  window.__ModuleLoader__ = {
    load: ({ factory }) =>
      factory((dep) => {
        if (!(dep in modules)) throw new Error('Missing host module ' + dep)
        return modules[dep]
      }).apply(services),
  }
  for (const name of ['model-selector', 'system-inject', 'session-manager', 'side'])
    await import('/client/' + name + '.js')
  function Slot({ name, id, info, ...props }) {
    return slots
      .get(name)
      .map(({ options, component: Component }) => (
        <Component
          key={options.id ?? options.key ?? name}
          {...options.inject?.(id)}
          sessionId={id}
          locked={false}
          useProjection={(key) => info.projections[key]}
          useSession={(select) =>
            select({ subagent: info.header.origin === 'subagent' ? {} : null })
          }
          useSessions={(select) => select({ byId: { [id]: info.header } })}
          {...props}
        />
      ))
  }
  function Workbench() {
    const [section, setSection] = useState('conversation')
    const info = React.useSyncExternalStore(infoStore.subscribe, infoStore.getState)
    const layout = React.useSyncExternalStore(dock.subscribe, dock.getState)
    const tabs = layout.tabs.filter((t) => t.sessionId === info.id)
    const side = layout.expanded && tabs.find((t) => t.tabId === layout.active[info.id])
    const tabInfo = (t) => () => ({
      panel: { isFloating: false },
      tab: {
        id: t.tabId,
        actions: { close: () => sidebarRight.closeIn(t.sessionId, t.tabId) },
        contentId: t.contentId,
        visible: true,
        signal: t.controller.signal,
        navigation: t.navigation,
      },
    })
    const [guide, setGuide] = useState(false)
    const [candidates, setCandidates] = useState([])
    const [query, setQuery] = useState('side')
    const commandSession = { sessionId: info.id }
    const signal = () => new AbortController().signal
    return (
      <>
        <nav aria-label="测试宿主导航">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={async () => {
                await refreshProjection(s.id)
                current.setState({ key: s.id })
                setSection('conversation')
              }}
            >
              {s.id}
            </button>
          ))}
          <button onClick={() => setSection('rong-aio-system-inject')}>破甲设置</button>
          <button onClick={() => setSection('rong-aio-session-manager')}>会话管理</button>
          <select
            aria-label="界面语言"
            defaultValue="zh"
            onChange={(e) => {
              locale.setLocale(e.target.value)
              setCandidates([])
            }}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
          <input
            aria-label="搜索命令"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCandidates([])
            }}
          />
          <button
            onClick={async () =>
              setCandidates(
                await slash.candidates(commandSession, {
                  query,
                  position: 'leading',
                  signal: signal(),
                }),
              )
            }
          >
            打开命令菜单
          </button>
          {candidates.map((row) => (
            <button
              key={row.name}
              aria-label={'/' + row.name}
              onClick={() => {
                slash.onPick({
                  session: commandSession,
                  candidate: row,
                  span: { start: 0, end: 5 },
                })
                setCandidates([])
              }}
            >
              {row.icon && <row.icon size={16} />}
              {row.label} /{row.name}
            </button>
          ))}
          <button
            onClick={() => slash.matchEnter(commandSession, '/side', signal(), { attachments: 0 })}
          >
            输入 /side 并回车
          </button>
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
            <header aria-label="主会话标题行">
              {info.id}
              <Slot name="conversation.session.header.utilities" id={info.id} info={info} />
              <button aria-label="更多">…</button>
            </header>
            <button onClick={() => setGuide(true)}>右侧栏开始页</button>
            {guide && (
              <aside aria-label="开始页工具">
                <GuideBody
                  useTabInfo={() => ({
                    tab: {
                      actions: {
                        openTab: (kind) => services.sidebarRight.openTab(kind),
                        close: () => setGuide(false),
                      },
                    },
                  })}
                  useGuideEntries={(select) =>
                    select(
                      [...sidebarTabTypes.values()].flatMap((type) =>
                        (type.guide ?? []).map((entry) => ({
                          ...entry,
                          providerId: type.id,
                          kind: type.kind,
                        })),
                      ),
                    )
                  }
                  useShortcuts={(select) => select([])}
                  useEntryPins={(select) => select([])}
                  useEntryActions={(select) => select(false)}
                  renderSlot={(_name, _props, options) => options.fallback}
                  renderSlotChain={(_name, _props, options) => options.fallback}
                />
              </aside>
            )}
            <div aria-label="侧聊标签">
              {tabs.map((t) => (
                <button
                  role="tab"
                  aria-selected={t === side}
                  key={t.tabId}
                  onClick={() => sidebarRight.focus(t.tabId)}
                >
                  <Slot
                    name="sidebar.right.pane.tab.title"
                    id={info.id}
                    info={info}
                    useTabInfo={tabInfo(t)}
                  />
                </button>
              ))}
            </div>
            {side && (
              <aside
                aria-label="侧聊面板"
                style={{
                  width: 'min(380px, 100%)',
                  height: 420,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <button
                  onClick={() => {
                    sidebarRight.closeIn(info.id, side.tabId)
                  }}
                >
                  关闭侧聊面板
                </button>
                <Slot
                  name="sidebar.right.pane.tab"
                  key={side.tabId}
                  id={info.id}
                  info={info}
                  useTabInfo={tabInfo(side)}
                  SessionProvider={({ session }) => (
                    <div
                      className={conversation.body + ' ' + conversation.embeddedBody}
                      data-content-phase="active"
                    >
                      <div className={conversation.scrollBody}>
                        <output aria-label="当前侧聊">{session.sessionId}</output>
                        <div className={conversation.composerSeat}>
                          <div className={inputBar.root}>
                            <div className={inputBar.card}>
                              <div
                                className={inputBar.input}
                                role="textbox"
                                aria-label="会话输入"
                              />
                              <div className={inputBar.row}>
                                <div>
                                  <span
                                    data-slot="conversation.input.permission"
                                    style={{ display: 'contents' }}
                                  >
                                    <button aria-label="宿主权限预设">默认权限</button>
                                  </span>
                                  <Slot
                                    name="conversation.input.left"
                                    id={session.sessionId}
                                    info={info}
                                  />
                                </div>
                                <button aria-label="会话发送" className={inputBar.primary} />
                              </div>
                            </div>
                            <div className={inputBar.dock} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  renderSlot={() => null}
                />
              </aside>
            )}
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
