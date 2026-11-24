import type { Context } from '@deepseek-ai/cordis'
import type { SidebarRightTabInfo, TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createStore } from 'zustand/vanilla'
import { isSideSession, type SideRow } from '../shared/protocol.ts'
import { command, isUnsentDraft, selectedSessionOf, SideClient } from './store.ts'

export const kind = 'rong-side'
export const resource = 'dsh-resource://rong-side/'
type NativeTab = SidebarRightTabInfo['tab']
type InventoryTab = ReturnType<Context['sidebarRight']['openTabs']['getSnapshot']>[number]
const tabKey = (source: string, id: string, contentId: string) =>
  JSON.stringify([source, id, contentId])
function represents(tab: InventoryTab, row: SideRow) {
  return (
    tab.kind === kind &&
    (tab.contentId === resource + row.id ||
      tabKey(tab.sessionId, tab.tabId, tab.contentId) === row.tabKey)
  )
}
/** A tab occurrence outlives its React body when the user changes tabs or sessions. */
export class SideTabs {
  private readonly clients = new Map<AbortSignal, SideClient>()
  readonly drafts = createStore<readonly SideClient[]>(() => [])
  readonly historyChanges = new EventTarget()
  private readonly lifetime = new AbortController()
  constructor(private readonly ctx: Context) {}
  get sessionStatus() {
    return this.ctx.uiSession.sessionStatus
  }
  client(source: SessionId, tab: NativeTab) {
    const existing = this.clients.get(tab.signal)
    if (existing) return existing
    const client = new SideClient(
      this.ctx.sessions,
      source,
      tab.id,
      () => tab.actions.close(),
      tabKey(source, tab.id, tab.contentId),
      tab.contentId.startsWith(resource) ? tab.contentId.slice(resource.length) : undefined,
      tab.contentId === 'sidebar://' + kind,
    )
    this.clients.set(tab.signal, client)
    const stop = client.view.subscribe((next, previous) => {
      const wasDraft = isUnsentDraft(previous.phase)
      const isDraft = isUnsentDraft(next.phase)
      if (isDraft === wasDraft) return
      this.drafts.setState(
        (drafts) => (isDraft ? [...drafts, client] : drafts.filter((c) => c !== client)),
        true,
      )
      if (wasDraft && selectedSessionOf(next.phase)) {
        const parent = previous.phase.kind === 'draft' ? previous.phase.draft.fork.parent : ''
        if (parent) this.historyChanges.dispatchEvent(new Event(parent))
      }
    })
    tab.signal.addEventListener(
      'abort',
      () => {
        stop()
        if (isUnsentDraft(client.view.getState().phase))
          this.drafts.setState((drafts) => drafts.filter((c) => c !== client), true)
        client.dispose()
        this.clients.delete(tab.signal)
      },
      { once: true, signal: this.lifetime.signal },
    )
    return client
  }
  show(quote?: string) {
    this.ctx.sidebarRight.openTab(kind, { params: quote ? { quote } : undefined })
  }
  private findClient(source: SessionId, tab: TabId) {
    return [...this.clients.values()].find((c) => c.tabId === tab && c.source === source)
  }
  async focus(source: SessionId, tab: TabId) {
    const sidebar = this.ctx.sidebarRight
    if (sidebar.mounted.getSnapshot() !== source) {
      const navigation = this.ctx.get('uiWorkspace') as { openSession(id: SessionId): void }
      navigation.openSession(source)
      const mounted = sidebar.mounted as {
        getSnapshot(): SessionId | undefined
        subscribe?: (listener: () => void) => () => void
      }
      await new Promise<void>((resolve) => {
        let frames = 0
        let raf = 0
        let unsubscribe: (() => void) | undefined
        const finish = () => {
          cancelAnimationFrame(raf)
          unsubscribe?.()
          resolve()
        }
        if (typeof mounted.subscribe === 'function') {
          unsubscribe = mounted.subscribe(() => {
            if (mounted.getSnapshot() === source) finish()
          })
        }
        const tick = () => {
          if (this.lifetime.signal.aborted || mounted.getSnapshot() === source || ++frames >= 15)
            finish()
          else raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      })
      if (this.lifetime.signal.aborted || sidebar.mounted.getSnapshot() !== source) return
    }
    const client = this.findClient(source, tab)
    if (!sidebar.isExpanded() && !client?.isFloating) sidebar.toggleExpanded()
    sidebar.focus(tab)
  }
  private instances(row: SideRow) {
    const live = [...this.clients.values()].filter(
      (c) => selectedSessionOf(c.view.getState().phase) === row.id,
    )
    return this.ctx.sidebarRight.openTabs
      .getSnapshot()
      .filter(
        (tab) =>
          represents(tab, row) ||
          live.some((c) => c.source === tab.sessionId && c.tabId === tab.tabId),
      )
  }
  async open(source: SessionId, row: SideRow) {
    const matches = this.instances(row)
    const match = matches.find((t) => t.sessionId === source) ?? matches[0]
    if (match) await this.focus(match.sessionId, match.tabId)
    else this.ctx.sidebarRight.openResource(resource + row.id, { kind })
  }
  async remove(parent: SessionId, row: SideRow) {
    await command({ parent, action: 'delete', id: row.id, confirmed: true })
    this.historyChanges.dispatchEvent(new Event(parent))
    const sidebar = this.ctx.sidebarRight
    for (const tab of this.instances(row)) {
      if (sidebar.mounted.getSnapshot() === tab.sessionId) sidebar.close(tab.tabId)
      else this.findClient(tab.sessionId, tab.tabId)?.close()
    }
  }
  dispose() {
    for (const c of this.clients.values()) c.dispose()
    this.clients.clear()
    this.lifetime.abort()
    this.drafts.setState([], true)
  }
}
export const claimsSide = (address: string) =>
  address.startsWith(resource) && isSideSession(address.slice(resource.length))
