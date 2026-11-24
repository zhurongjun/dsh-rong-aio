import type { Permission } from './commands.ts'

export const API = '/api/rong-aio.side'
export type { Permission } from './commands.ts'
export interface SideRow {
  id: string
  tabKey?: string
  title: string
  forkedAt: number
  updatedAt: number
  permission: Permission
  pending: boolean
}
export interface SideHistory {
  rows: SideRow[]
  parentPermission: string
}
/** Parent identity fixed when a draft opens. The first send chooses the log position. */
export interface SideParent {
  parent: string
  createdAt: number
}

export interface SideDraftInfo extends SideHistory {
  fork: SideParent
}

export function sideTitle(text: string) {
  return text.trim().replace(/\s+/g, ' ').slice(0, 64)
}

const prefix = 'rong-side-'

export const sideSessionId = (key: string) => prefix + key
export const isSideSession = (id: string) =>
  /^rong-side-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)
