import { z } from 'zod'

/** 只有本会话显式选择能开启破甲；null 表示关闭，不提供继承默认规则的空状态。 */
export const nameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => value !== '.' && value !== '..', 'name 不能为 . 或 ..')
export const selectionSchema = z.object({ name: nameSchema.nullable() }).strict()
export const snapshotSchema = z
  .object({
    display_name: z.string().min(1).max(120),
    description: z.string().max(500),
    body: z
      .string()
      .min(1)
      .max(200_000)
      .refine((value) => !!value.trim(), '正文不能为空'),
  })
  .strict()
export const injectStateSchema = selectionSchema.extend({ snapshot: snapshotSchema.optional() })
export type InjectState = z.infer<typeof injectStateSchema>
export const promptSchema = snapshotSchema
  .extend({
    name: nameSchema,
    display_name: z.string().max(120).default(''),
    description: z.string().max(500).default(''),
  })
  .transform((value) => ({ ...value, display_name: value.display_name || value.name }))
export type Prompt = z.infer<typeof promptSchema>
export type Scope = 'user' | 'workspace'
// user/workspace 仅保留用于读取已有冻结文件的来源元信息，运行时不再解析这些层级。
export const sourceSchema = z.enum(['user', 'workspace', 'session', 'parent', 'none'])
export type Source = z.infer<typeof sourceSchema>
export const frozenSchema = z
  .object({
    version: z.literal(1),
    state: injectStateSchema.refine(
      (state) =>
        state.name !== undefined &&
        (state.name === null ? state.snapshot === undefined : !!state.snapshot),
      '冻结状态缺少正文或明确选择',
    ),
    frozen_at: z.string().datetime(),
    source: sourceSchema,
    inherited_from: z.string().optional(),
  })
  .strict()
export type FrozenSession = z.infer<typeof frozenSchema>
export interface CatalogPrompt extends Prompt {
  file: string
  scope: Scope
  revision: string
  conflict: boolean
}
export interface ResolvedState {
  state: InjectState
  status: 'on' | 'off' | 'invalid'
  source: Source
  editable: boolean
  message?: string
}
export const SOURCE_LABELS: Record<Source, string> = {
  user: '历史用户规则',
  workspace: '历史工程规则',
  session: '本会话选择',
  parent: '继承父会话',
  none: '未开启',
}

/** 唯一解析链路。冻结状态的正文独立于文件索引，绝不重新查找或替换。 */
export function resolveState(input: {
  session?: InjectState
  frozen?: FrozenSession
  prompts: CatalogPrompt[]
  errors?: string[]
}): ResolvedState {
  if (input.frozen)
    return {
      state: input.frozen.state,
      status: input.frozen.state.name === null ? 'off' : 'on',
      source: input.frozen.source,
      editable: false,
    }
  const state: InjectState = { name: input.session?.name ?? null }
  const source: Source = state.name === null ? 'none' : 'session'
  const result = { state, source, editable: true }
  // 关闭不依赖模板库或白名单是否可读；文件诊断仍在管理页/选择菜单显示。
  if (state.name === null) return { ...result, status: 'off' }
  if (input.errors?.length)
    return { ...result, status: 'invalid', message: input.errors.join('；') }
  const matches = input.prompts.filter((prompt) => prompt.name === state.name)
  if (matches.length !== 1 || matches[0]?.conflict)
    return {
      ...result,
      status: 'invalid',
      message: matches.length ? `破甲词名称冲突：${state.name}` : `破甲词已失效：${state.name}`,
    }
  const { display_name, description, body } = matches[0]
  return {
    ...result,
    state: { ...state, snapshot: { display_name, description, body } },
    status: 'on',
  }
}

/** 展示只是宿主解析结果的格式化，不进行模板查找或模型授权判断。 */
export function stateLabel(result: ResolvedState): string {
  if (result.status === 'invalid') return `${result.state.name ?? '破甲配置'} · 已失效`
  return result.status === 'off' ? '未破甲' : result.state.snapshot!.display_name
}
export function prefixMatches(system: string, body: string): boolean {
  return system === body || system.startsWith(body + '\n\n')
}
