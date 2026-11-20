import { API, type SideDraftInfo, type SideHistory } from '../shared/protocol.ts'
import type { SideCommand } from '../shared/commands.ts'

async function request<T>(url: string, signal?: AbortSignal, body?: SideCommand): Promise<T> {
  const response = await fetch(url, {
    signal,
    cache: 'no-store',
    ...(body && {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '读取侧聊失败')
  return data
}

export function loadHistory(parent: string, signal?: AbortSignal) {
  return request<SideHistory>(API.slice(1) + '?' + new URLSearchParams({ parent }), signal)
}
export function loadDraft(parent: string, signal: AbortSignal) {
  return request<SideDraftInfo>(API.slice(1), signal, { action: 'draft', parent })
}
export function command(body: Exclude<SideCommand, { action: 'draft' }>, signal?: AbortSignal) {
  return request<{ id: string }>(API.slice(1), signal, body)
}
