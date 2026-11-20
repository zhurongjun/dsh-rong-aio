export const API = '/api/rong-aio.session-manager'

export interface Target {
  id: string
  createdAt: number
}

export interface SessionRow extends Target {
  title: string
  cwd?: string
  workspace: { key: string; title: string }
  directory?: string
  canOpenDirectory: boolean
  archived: boolean
  live: boolean
}

export type Action = 'archive' | 'restore' | 'delete'
export interface Outcome {
  id: string
  error?: string
}

export interface BatchResult {
  outcomes: Outcome[]
  warning?: string
}
