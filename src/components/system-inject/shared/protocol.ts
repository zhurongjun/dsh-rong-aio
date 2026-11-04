import { z } from 'zod'
import {
  promptSchema,
  selectionSchema,
  type CatalogPrompt,
  type FrozenSession,
  type InjectState,
  type ResolvedState,
  type Scope,
} from './state.ts'

/** HTTP 契约只传输文件投影和统一状态，不构造第二套持久化配置。 */
export const API = '/api/rong-aio.system-inject'
const id = z.string().min(1).max(4096)
export const routeSchema = z.object({ provider: id, model: id }).strict()
export type Route = z.infer<typeof routeSchema>
/** 目录名称只供界面展示，授权持久化和护栏仍只使用 Route 中的精确标识。 */
export interface CatalogRoute extends Route {
  providerName?: string
  modelName?: string
}
const revision = z.string().min(1)
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('select'), sessionId: id, state: selectionSchema }).strict(),
  z
    .object({
      type: z.literal('acknowledge-error'),
      sessionId: id,
      noticeId: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('save-template'),
      revision,
      scope: z.enum(['user', 'workspace']),
      file: id.optional(),
      template: promptSchema,
      confirmed: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('delete-template'),
      revision,
      file: id,
      confirmed: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('whitelist'), revision, routes: z.array(routeSchema) }).strict(),
])
export type Command = z.infer<typeof commandSchema>
export interface RequestFailure {
  id: number
  message: string
  route?: Route
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
  state: InjectState
  frozen?: FrozenSession
  resolved: ResolvedState
  busy: boolean
  error?: RequestFailure
}
export interface StateView {
  config?: ConfigView
  resolved: ResolvedState
  session?: SessionView
  references: Record<string, string[]>
  routes: CatalogRoute[]
  catalogErrors: string[]
}
