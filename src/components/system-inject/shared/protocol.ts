/** 破甲组件的 HTTP 命令与视图契约；文件投影、会话状态和操作通知分别传输。 */

import { z } from 'zod'
import {
  promptSchema,
  selectionSchema,
  type CatalogPrompt,
  type ResolvedState,
  type Scope,
} from './state.ts'

/** HTTP 契约只传输文件投影和统一状态，不构造第二套持久化配置。 */
export const API = '/api/rong-aio.system-inject'

const id = z.string().min(1).max(4096)

/** 授权键由 provider 与 model 精确组成，两个标识均不按名称或家族推断。 */
export const routeSchema = z.object({ provider: id, model: id }).strict()

export type Route = z.infer<typeof routeSchema>

/** 目录名称只供界面展示，授权持久化和护栏仍只使用 Route 中的精确标识。 */
export interface CatalogRoute extends Route {
  /** 提供商展示名；缺失时 UI 回退到 provider ID。 */
  providerName?: string

  /** 模型展示名；不参与白名单持久化或精确匹配。 */
  modelName?: string
}

const revision = z.string().min(1)

/** HTTP 写命令的严格校验入口。选词、通知确认、文件编辑与白名单修改各有独立字段。 */
export const commandSchema = z.discriminatedUnion('type', [
  // 会话选择与通知确认：以 session ID 定位，禁止夹带正文快照。
  z.object({ type: z.literal('select'), sessionId: id, state: selectionSchema }).strict(),
  z
    .object({
      type: z.literal('acknowledge-error'),
      sessionId: id,
      noticeId: z.number().int().positive(),
    })
    .strict(),

  // 文件编辑：携带读取时版本；危险的引用变更需显式 confirmed。
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

  // 授权修改只接受精确路由；重复项由宿主保存逻辑去重。
  z.object({ type: z.literal('whitelist'), revision, routes: z.array(routeSchema) }).strict(),
])

export type Command = z.infer<typeof commandSchema>

/** 一次可确认的操作结果；不能用该对象推断当前破甲是否开启。 */
export interface RequestFailure {
  /** 宿主递增通知 ID，用于忽略迟到的确认回调。 */
  id: number

  /** 供 Toast 展示的失败原因。 */
  message: string
}

/** 管理范围的文件投影，revision 覆盖白名单、目录和诊断。 */
export interface ConfigView {
  /** 整个设置范围的版本；提交编辑时必须原样带回。 */
  revision: string

  /** 绑定工作区绝对路径；空字符串表示仅用户范围。 */
  workspace: string

  /** 当前范围扫描出的模板，包括冲突标记。 */
  templates: CatalogPrompt[]

  /** 用户级精确授权列表，工程和会话不能扩张。 */
  whitelist: Route[]

  /** 可选保存范围对应的 prompts 目录，用于显示文件位置。 */
  paths: Partial<Record<Scope, string>>

  /** 配置与模板的读取/解析诊断。 */
  errors: string[]
}

/** 会话唯一展示投影；正文只存在于 resolved.state.snapshot，避免多个状态来源。 */
export interface SessionView {
  /** 响应所属的原生会话 ID，前端接收时必须核对。 */
  sessionId: string

  /** 原生会话工作区，决定从输入框进入管理页时的固定范围。 */
  workspace: string

  /** 继承快照的父会话 ID，仅用于只读说明。 */
  inheritedFrom?: string

  /** 唯一的最终状态、来源、有效性及编辑资格。 */
  resolved: ResolvedState

  /** 首次请求捕获阶段占用，界面据此禁用改选。 */
  busy: boolean

  /** 尚未确认的拒绝通知；与 resolved 相互独立。 */
  error?: RequestFailure
}

/** 一次 API 响应；按入口携带 config 或 session，目录名称仅供管理界面展示。 */
export interface StateView {
  /** 设置或可编辑菜单所需文件投影；冻结会话可以省略。 */
  config?: ConfigView

  /** 会话入口的权威状态；全局设置入口不构造虚拟会话。 */
  session?: SessionView

  /** 按模板 name 归集当前宿主临时选择，用于改名/删除前提示。 */
  references: Record<string, string[]>

  /** 宿主公开模型目录的展示投影，新增白名单时使用。 */
  routes: CatalogRoute[]

  /** 模型目录部分加载失败的诊断，保留已加载提供商。 */
  catalogErrors: string[]
}
