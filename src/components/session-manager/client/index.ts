import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconArchiveOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionManager } from './SessionManager.tsx'
import css from './styles.css'

export const inject = ['slots', 'sessions']
const id = 'rong-aio-session-manager'

export function apply(ctx: Context) {
  const refreshSidebar = () => ctx.sessions.refresh()
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  })
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({ name: 'settings.section', id, order: 61, label: '会话管理' }, () =>
      createElement(SessionManager, { refreshSidebar }),
    ),
  )
  ctx.slots.inject('settings.section.icon', () =>
    ctx.slots.register({ name: 'settings.section.icon', id }, ({ size }) =>
      createElement(IconArchiveOutlineRegular, { size }),
    ),
  )
}
