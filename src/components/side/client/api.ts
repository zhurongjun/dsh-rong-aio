import { requestJson } from '../../../client/http.ts'
import { API, type SideDraftInfo, type SideHistory } from '../shared/protocol.ts'
import type { SideCommand } from '../shared/commands.ts'

export function loadHistory(parent: string, signal?: AbortSignal) {
  return requestJson<SideHistory>(API.slice(1) + '?' + new URLSearchParams({ parent }), {
    signal,
    fallbackError: '读取侧聊失败',
  })
}

export function loadDraft(parent: string, signal: AbortSignal) {
  return requestJson<SideDraftInfo>(API.slice(1), {
    method: 'POST',
    body: { action: 'draft', parent } satisfies SideCommand,
    signal,
    fallbackError: '读取侧聊失败',
  })
}

export function command(body: Exclude<SideCommand, { action: 'draft' }>, signal?: AbortSignal) {
  return requestJson<{ id: string }>(API.slice(1), {
    method: 'POST',
    body,
    signal,
    fallbackError: '读取侧聊失败',
  })
}
