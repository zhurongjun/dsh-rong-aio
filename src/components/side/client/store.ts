import type { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createStore } from 'zustand/vanilla'
import { sideTitle, type SideParent, type Permission } from '../shared/protocol.ts'
import { command, loadDraft, loadHistory } from './api.ts'

interface Draft {
  key: string
  fork: SideParent
  text: string
}
interface View {
  draft?: Draft
  selected?: string
  reference?: SessionReference
  busy: boolean
  error: string
  title: string
  permission: Permission
  parentPermission: string
  checkingPermission: boolean
}
export class SideClient {
  readonly view = createStore<View>(() => ({
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
      this.patch({ busy: false, error: String(error) })
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
          selected: row.id,
          permission: row.permission,
        })
      } else if (addressId) {
        throw new Error('这条侧聊已删除或不属于当前主会话')
      } else {
        this.patch({
          parentPermission,
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
      this.patch({ reference: ref, draft: undefined })
    } catch (error) {
      if (!signal.aborted) {
        signal.removeEventListener('abort', release)
        release()
      }
      throw error
    }
  }
  connect() {
    const { selected: id, reference } = this.view.getState()
    const parent = this.parent
    if (!id || !parent || reference) return
    return this.run(async () => {
      await command({ action: 'open', id, parent }, this.lifetime.signal)
      await this.retain(id)
    })
  }
  async retry(quote?: string) {
    if (!this.view.getState().selected) {
      this.opening = undefined
      await this.enter(quote)
      if (this.view.getState().error) return
    }
    await this.connect()
  }
  edit(text: string) {
    const { busy, selected, draft } = this.view.getState()
    if (draft && !busy && !selected && text !== draft.text)
      this.patch({ draft: { ...draft, text } })
  }
  async refreshPermission() {
    const parent = this.parent
    const { selected: id, checkingPermission } = this.view.getState()
    if (!parent || checkingPermission) return
    this.patch({ checkingPermission: true, error: '' })
    try {
      const { rows, parentPermission } = await loadHistory(parent, this.lifetime.signal)
      const row = id && rows.find((r) => r.id === id)
      if (id && !row) throw new Error('找不到这条侧聊')
      this.patch({
        parentPermission,
        checkingPermission: false,
        ...(row && { permission: row.permission }),
      })
    } catch (error) {
      this.patch({ checkingPermission: false, error: String(error) })
    }
  }
  setPermission(permission: Permission) {
    const parent = this.parent
    const { selected: id, draft, reference, busy } = this.view.getState()
    if (!parent || busy || permission === this.view.getState().permission) return
    if (reference && id)
      return this.run(async () => {
        await command({ parent, action: 'permission', id, permission }, this.lifetime.signal)
        this.patch({ permission })
      })
    if (draft && !id) this.patch({ permission })
  }
  send() {
    const draft = this.view.getState().draft
    if (!draft?.text.trim() || this.view.getState().selected) return
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
      this.patch({ selected: id, title: sideTitle(draft.text) })
      await this.retain(id)
    })
  }
  dispose() {
    this.lifetime.abort()
  }
}
