import type { CatalogPrompt, InjectState, Prompt, ResolvedState, Scope } from './state.ts'

export const API = '/api/rong-aio.system-inject'

export interface Route {
  provider: string
  model: string
}

export interface CatalogRoute extends Route {
  providerName?: string
  modelName?: string
}

export type Command =
  | { type: 'select'; sessionId: string; state: InjectState }
  | { type: 'acknowledge-error'; sessionId: string; noticeId: number }
  | {
      type: 'save-template'
      revision: string
      scope: Scope
      file?: string
      template: Prompt
      confirmed?: boolean
    }
  | { type: 'delete-template'; revision: string; file: string; confirmed?: boolean }
  | { type: 'whitelist'; revision: string; routes: Route[] }

export interface RequestFailure {
  id: number
  message: string
}

export interface ConfigView {
  revision: string
  workspace: string
  templates: CatalogPrompt[]
  whitelist: Route[]
  paths: Partial<Record<Scope, string>>
  errors: string[]
}

export interface SessionView {
  sessionId: string
  workspace: string
  inheritedFrom?: string
  resolved: ResolvedState
  busy: boolean
  error?: RequestFailure
}

export interface StateView {
  config?: ConfigView
  session?: SessionView
  references: Record<string, string[]>
  routes: CatalogRoute[]
  catalogErrors: string[]
}

export const INJECT_SELECTION_ERROR = 'rong-aio/inject-selection-rejected'

export function isInjectSelectionError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    value.code === INJECT_SELECTION_ERROR
  )
}
