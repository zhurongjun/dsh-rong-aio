import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Composer } from './Composer.tsx'
import { Settings } from './Settings.tsx'
import { createInjectStore } from './store.ts'
import { SETTINGS_LABEL, SettingsNavIcon } from './SettingsNavIcon.tsx'
import css from './styles.css'

export const inject = ['slots', 'sessions', 'conversation']
export function apply(ctx: Context): void {
  const settingsStores = new Map<string, ReturnType<typeof createInjectStore>>()
  const settingsFor = (workspace = '') => {
    let store = settingsStores.get(workspace)
    if (!store) {
      store = createInjectStore(undefined, workspace)
      settingsStores.set(workspace, store)
    }
    return store
  }
  const stores = new Map<string, ReturnType<typeof createInjectStore>>()
  const storeFor = (sessionId: string) => {
    let store = stores.get(sessionId)
    if (!store) {
      store = createInjectStore(sessionId)
      stores.set(sessionId, store)
    }
    return store
  }
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-rong-aio-system-inject'
    style.textContent = css
    document.head.append(style)
    return () => {
      style.remove()
      for (const store of settingsStores.values()) store.dispose()
      settingsStores.clear()
      for (const store of stores.values()) store.dispose()
      stores.clear()
    }
  })
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.left',
        id: 'rong-aio-system-inject',
        order: -100,
        inject(sessionId) {
          return {
            store: storeFor(sessionId),
            settingsFor,
            blocks: ctx.conversation.blocks,
            available: ctx.sessions.subagentAddress(sessionId) === undefined,
          }
        },
      },
      Composer,
    ),
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'rong-aio-system-inject', order: 60, label: SETTINGS_LABEL },
      () => createElement(Settings, { store: settingsFor() }),
    ),
  )
  ctx.slots.inject('settings.action', () =>
    ctx.slots.register(
      { name: 'settings.action', id: 'rong-aio-system-inject-icon' },
      SettingsNavIcon,
    ),
  )
}
