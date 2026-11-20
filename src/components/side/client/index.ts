import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { Button, IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { isSideSession } from '../../../shared/side-session.ts'
import { Conversation, Panel, TabTitle } from './Panel.tsx'
import { Manager } from './Manager.tsx'
import { EmbeddedPermission } from './PermissionControl.tsx'
import { kind, SideTabs, resource, claimsSide } from './tabs.ts'
import css from './styles.css'
import { filterNavigation } from './catalog.ts'
import zh from '../locale/zh.json'
import en from '../locale/en.json'

export const inject = [
  'slots',
  'sidebarRight',
  'sidebarRightTabs',
  'sessions',
  'uiConversation',
  'uiSession',
  'uiWorkspace',
  'commandUi',
  'locale',
]
const id = 'dsh-rong-aio-side'
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'rong-side': { quote: string }
  }
}
export function apply(ctx: Context) {
  filterNavigation(ctx)
  const tabs = new SideTabs(ctx)
  const current = ctx.uiSession.adapter.current
  function tabProps({ tab, panel }: SidebarRightTabInfo, sessionId: SessionId) {
    const source = isSideSession(sessionId)
      ? (ctx.sidebarRight.mounted.getSnapshot() ?? sessionId)
      : sessionId
    const store = tabs.client(source, tab)
    store.isFloating = panel.isFloating
    const params = tab.navigation.params
    return { store, quote: params && 'quote' in params ? params.quote : undefined }
  }
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    return () => {
      style.remove()
      tabs.dispose()
    }
  })
  ctx.effect(() => ctx.locale.register(id, 'zh', zh.command))
  ctx.effect(() => ctx.locale.register(id, 'en', en.command))
  const t = ctx.locale.bind(id)
  const title = () => t('label')
  const description = () => t('description')
  ctx.sidebarRightTabs.register({
    id,
    kind,
    multiple: true,
    keepMounted: true,
    patterns: [resource + '**'],
    canOpen: claimsSide,
    title,
    guide: [
      {
        id: 'side',
        order: 50,
        title,
        description,
        icon: IconBranchOutlineRegular,
      },
    ],
  })
  ctx.commandUi.register({
    name: 'side',
    label: title,
    description,
    icon: IconBranchOutlineRegular,
    available: ({ sessionId }) => sessionId === current.getSnapshot().key,
    ui: { kind: 'action', run: () => tabs.show() },
  })
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      {
        name: 'sidebar.right.pane.tab',
        key: id,
        children: { 'rong.side.conversation': { kind: 'single', scope: 'session' } },
      },
      function SideTab(props) {
        const info = props.useTabInfo()
        if (!info.tab.visible) return null
        return createElement(Panel, { ...props, ...tabProps(info, props.sessionId) })
      },
    ),
  )
  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: id }, (props) =>
      createElement(TabTitle, tabProps(props.useTabInfo(), props.sessionId)),
    ),
  )
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      { name: 'conversation.session.header.utilities', id, order: -1 },
      (props) => {
        const subagent = props.useSession((s) => s.subagent !== null)
        if (subagent || isSideSession(props.sessionId)) return null
        return createElement(Manager, { key: props.sessionId, tabs, source: props.sessionId })
      },
    ),
  )
  ctx.slots.inject('rong.side.conversation', () =>
    ctx.slots.register({ name: 'rong.side.conversation' }, Conversation),
  )
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register({ name: 'conversation.input.left', id, order: -110 }, EmbeddedPermission),
  )
  ctx.uiConversation.interactions.register({
    id,
    onInteraction(req) {
      if (
        !req.hasSelection ||
        isSideSession(req.sessionId) ||
        req.sessionId !== current.getSnapshot().key
      )
        return
      if (req.trigger === 'contextmenu') req.preventDefault()
      else if (ctx.uiConversation.interactions.getSnapshot().includes('quote')) return
      req.open()
    },
  })
  ctx.slots.inject('conversation.chat.text-interaction', () =>
    ctx.slots.register(
      { name: 'conversation.chat.text-interaction', key: id },
      ({ readText, dismiss }) =>
        createElement(
          Button,
          {
            size: 'sm',
            onPointerDown: (e) => e.preventDefault(),
            onClick: () => {
              const text = readText()
              dismiss()
              if (text) tabs.show(text)
            },
          },
          '在侧聊中提问',
        ),
    ),
  )
}
