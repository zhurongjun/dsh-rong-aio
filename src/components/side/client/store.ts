import type { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createStore } from 'zustand/vanilla'
import { errorMessage } from '../../../shared/error.ts'
import { sideTitle, type SideParent, type Permission } from '../shared/protocol.ts'
import { command, loadDraft, loadHistory } from './api.ts'

export interface Draft {
  key: string
  fork: SideParent
  text: string
}

/** 侧聊标签生命周期：草稿（含创建中会话过渡态）、重连中、或已绑定原生会话。 */
export type SidePhase =
  | { kind: 'loading' }
  | { kind: 'draft'; draft: Draft; creatingSessionId?: string }
  | { kind: 'connecting'; selected: string }
  | { kind: 'ready'; selected: string; reference: SessionReference }

interface View {
  phase: SidePhase
  busy: boolean
  error: string
  title: string
  permission: Permission
  parentPermission: string
  checkingPermission: boolean
}

export function selectedSessionOf(phase: SidePhase): string | undefined {
  if (phase.kind === 'ready' || phase.kind === 'connecting') return phase.selected
  if (phase.kind === 'draft') return phase.creatingSessionId
  return undefined
}

export function isUnsentDraft(phase: SidePhase): boolean {
  return phase.kind === 'draft' && !phase.creatingSessionId
}

export class SideClient {
  readonly view = createStore<View>(() => ({
    phase: { kind: 'loading' },
    busy: false,
    error: '',
    title: '',
    permission: 'read',
    parentPermission: '',
    checkingPermission: false,
  }))
  private opening?: Promise<void>
  private parent?: string
  private readonly lifetime = new AbortController()
  private permissionVersion = 0
  private permissionAbort?: AbortController
  private panelActive = false
  isFloating = false

  constructor(
    private readonly sessions: Context['sessions'],
    readonly source: SessionId,
    readonly tabId: TabId,
    readonly close: () => void,
    readonly key: string,
    private readonly addressId: string | undefined,
    private readonly legacyTab: boolean,
  ) {}

  setFloating(floating: boolean) {
    this.isFloating = floating
  }

  /** 由视图挂载回调驱动标签身份同步与会话接入，避免在 Effect 中重复桥接。 */
  syncSurface(role: 'title' | 'panel', active: boolean, isFloating?: boolean, quote?: string) {
    if (role === 'panel') this.panelActive = active
    if (!active) return
    if (isFloating !== undefined) this.setFloating(isFloating)
    const entered = this.enter(quote)
    if (role === 'panel') {
      void entered.then(() => {
        if (this.panelActive && !this.view.getState().error) void this.connect()
      })
    }
  }

  private patch(fields: Partial<View>) {
    if (this.lifetime.signal.aborted) return
    this.view.setState(fields)
  }

  private async run(task: () => Promise<void>) {
    if (this.view.getState().busy || this.lifetime.signal.aborted) return
    this.patch({ busy: true, error: '' })
    try {
      await task()
    } catch (error) {
      this.patch({ busy: false, error: errorMessage(error) })
      return
    }
    this.patch({ busy: false })
  }

  enter(quote?: string) {
    return (this.opening ??= this.run(async () => {
      const { fork, rows, parentPermission } = await loadDraft(this.source, this.lifetime.signal)
      this.lifetime.signal.throwIfAborted()
      this.parent = fork.parent
      const addressId = this.addressId
      let row = rows.find((r) => (addressId ? r.id === addressId : r.tabKey === this.key))
      // An existing single-page layout used one last-selected id per parent.
      if (!row && this.legacyTab)
        row = rows.find((r) => r.id === sessionStorage.getItem('rong-side:last:' + fork.parent))
      if (row) {
        this.patch({
          parentPermission,
          title: row.title,
          phase: { kind: 'connecting', selected: row.id },
          permission: row.permission,
        })
      } else if (addressId) {
        throw new Error('这条侧聊已删除或不属于当前主会话')
      } else {
        this.patch({
          parentPermission,
          phase: {
            kind: 'draft',
            draft: {
              key: crypto.randomUUID(),
              fork,
              text: quote
                ? quote
                    .split('\n')
                    .map((line) => '> ' + line)
                    .join('\n') + '\n\n'
                : '',
            },
          },
        })
      }
    }))
  }

  private async retain(id: string) {
    const signal = this.lifetime.signal
    signal.throwIfAborted()
    if (!this.sessions.list.getSnapshot().byId[id as SessionId]) await this.sessions.refresh()
    signal.throwIfAborted()
    const ref = this.sessions.retain(id as SessionId, { source: 'rongSide' })
    const release = () => ref.release()
    signal.addEventListener('abort', release, { once: true })
    try {
      await ref.ready
      signal.throwIfAborted()
      this.patch({ phase: { kind: 'ready', selected: id, reference: ref } })
    } catch (error) {
      if (!signal.aborted) {
        signal.removeEventListener('abort', release)
        release()
      }
      throw error
    }
  }

  connect() {
    const { phase } = this.view.getState()
    const parent = this.parent
    if (phase.kind !== 'connecting' || !parent) return
    const id = phase.selected
    return this.run(async () => {
      await command({ action: 'open', id, parent }, this.lifetime.signal)
      await this.retain(id)
    })
  }

  async retry(quote?: string) {
    if (this.view.getState().phase.kind === 'loading') {
      this.opening = undefined
      await this.enter(quote)
      if (this.view.getState().error) return
    }
    await this.connect()
  }

  edit(text: string) {
    const { busy, phase } = this.view.getState()
    if (phase.kind === 'draft' && !phase.creatingSessionId && !busy && text !== phase.draft.text) {
      this.patch({ phase: { ...phase, draft: { ...phase.draft, text } } })
    }
  }

  async refreshPermission() {
    const parent = this.parent
    const { phase, checkingPermission } = this.view.getState()
    if (!parent || checkingPermission) return
    const id = selectedSessionOf(phase)
    const token = ++this.permissionVersion
    this.permissionAbort?.abort()
    const controller = new AbortController()
    this.permissionAbort = controller
    const abortRefresh = () => controller.abort()
    this.lifetime.signal.addEventListener('abort', abortRefresh, { once: true })
    this.patch({ checkingPermission: true, error: '' })
    try {
      const { rows, parentPermission } = await loadHistory(parent, controller.signal)
      if (this.lifetime.signal.aborted || token !== this.permissionVersion) return
      const row = id && rows.find((r) => r.id === id)
      if (id && !row) throw new Error('找不到这条侧聊')
      this.patch({
        parentPermission,
        checkingPermission: false,
        ...(row && { permission: row.permission }),
      })
    } catch (error) {
      if (this.lifetime.signal.aborted || token !== this.permissionVersion) return
      if (controller.signal.aborted) this.patch({ checkingPermission: false })
      else this.patch({ checkingPermission: false, error: errorMessage(error) })
    } finally {
      this.lifetime.signal.removeEventListener('abort', abortRefresh)
      if (this.permissionAbort === controller) this.permissionAbort = undefined
    }
  }

  setPermission(permission: Permission) {
    const parent = this.parent
    const { phase, busy } = this.view.getState()
    if (!parent || busy || permission === this.view.getState().permission) return
    this.permissionVersion++
    this.permissionAbort?.abort()
    if (phase.kind === 'ready') {
      return this.run(async () => {
        await command(
          { parent, action: 'permission', id: phase.selected, permission },
          this.lifetime.signal,
        )
        this.patch({ permission, checkingPermission: false })
      })
    }
    if (phase.kind === 'draft' && !phase.creatingSessionId) {
      this.patch({ permission, checkingPermission: false })
    }
  }

  send() {
    const { phase } = this.view.getState()
    if (phase.kind !== 'draft' || phase.creatingSessionId || !phase.draft.text.trim()) return
    this.permissionVersion++
    this.permissionAbort?.abort()
    const draft = phase.draft
    return this.run(async () => {
      const { id } = await command(
        {
          action: 'create',
          ...draft.fork,
          tabKey: this.key,
          key: draft.key,
          text: draft.text,
          permission: this.view.getState().permission,
        },
        this.lifetime.signal,
      )
      this.lifetime.signal.throwIfAborted()
      this.patch({
        phase: { kind: 'draft', draft, creatingSessionId: id },
        title: sideTitle(draft.text),
      })
      try {
        await this.retain(id)
      } catch (error) {
        this.patch({ phase: { kind: 'connecting', selected: id } })
        throw error
      }
    })
  }

  dispose() {
    this.permissionAbort?.abort()
    this.lifetime.abort()
  }
}
