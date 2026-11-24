import { useStore } from 'zustand'
import type {
  ConversationViewsProps,
  TextInteractionSurface,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  PropsRenderFactories,
  PropsRenderSlots,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconNewChatOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SideComposerContext } from './PermissionControl.tsx'
import { DraftComposer } from './DraftComposer.tsx'
import type { SideClient } from './store.ts'

export function SideError({ message, retry }: { message: string; retry?: () => void }) {
  if (!message) return null
  return (
    <div role="alert" className="rong-side-error">
      {message}
      {retry && (
        <Button size="sm" onClick={retry}>
          重试
        </Button>
      )}
    </div>
  )
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    rongSide: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'rong.side.conversation': { kind: 'single'; scope: 'session' }
    'conversation.chat.text-interaction': {
      kind: 'keyed'
      scope: 'session'
      owner: TextInteractionSurface
    }
  }
}

function ChatView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

export function Conversation({
  renderFactorySlot,
}: PropsRuntime<'rong.side.conversation'> & PropsRenderFactories) {
  return renderFactorySlot(
    'conversation.content',
    { variant: 'embedded', phase: 'active', hero: false },
    { slots: { views: ChatView } },
  )
}

export function TabTitle({
  store,
  isFloating,
  quote,
}: {
  store: SideClient
  isFloating?: boolean
  quote?: string
}) {
  const title = useStore(store.view, (s) => s.title) || '新侧聊'
  const bindTitle = (el: HTMLSpanElement | null) =>
    store.syncSurface('title', el !== null, isFloating, quote)

  return (
    <span ref={bindTitle} title={title}>
      {title}
    </span>
  )
}

type PanelProps = PropsRuntime<'sidebar.right.pane.tab'> &
  PropsRenderSlots<'rong.side.conversation'> & {
    store: SideClient
    isFloating?: boolean
    quote?: string
  }

export function Panel({ store, isFloating, quote, SessionProvider, renderSlot }: PanelProps) {
  const reference = useStore(store.view, (s) =>
    s.phase.kind === 'ready' ? s.phase.reference : undefined,
  )
  const error = useStore(store.view, (s) => s.error)
  const canRetry = useStore(
    store.view,
    (s) => s.phase.kind !== 'draft' || !!s.phase.creatingSessionId,
  )
  const bindPanel = (el: HTMLDivElement | null) =>
    store.syncSurface('panel', el !== null, isFloating, quote)

  if (reference) {
    return (
      <div ref={bindPanel} className="rong-side-chat">
        <SideComposerContext.Provider value={store}>
          <SessionProvider session={reference}>
            {renderSlot('rong.side.conversation', {})}
          </SessionProvider>
        </SideComposerContext.Provider>
        <SideError message={error} />
      </div>
    )
  }

  return (
    <div ref={bindPanel} className="rong-side-panel">
      <div className="rong-side-welcome">
        <IconNewChatOutlineRegular size={32} />
        <h2>侧聊</h2>
        <p>沿用主会话的上下文。发送首条消息后，可从侧聊列表再次打开。</p>
      </div>
      <SideError message={error} retry={canRetry ? () => void store.retry(quote) : undefined} />
      <DraftComposer store={store} />
    </div>
  )
}
