/** 破甲状态的唯一纯解析器及快照契约；不依赖 Zod、文件系统或宿主授权服务。 */

/** 模板文件来源范围，仅决定扫描/保存目录，不代表自动选词层级。 */
export type Scope = 'user' | 'workspace'

/** 状态来源：本会话显式选择、父会话继承或未开启。 */
export type Source = 'session' | 'parent' | 'none'

/** 冻结或解析后的正文副本：完整保留显示元信息和字面正文，不再通过名称反查。 */
export interface PromptSnapshot {
  /** 已解析显示名；冻结后不随模板改名变化。 */
  display_name: string

  /** 冻结时的简介，允许空字符串。 */
  description: string

  /** 字面正文，空白正文无效；不展开变量。 */
  body: string
}

/** 显式选择与可选正文快照的统一结构；name=null 明确关闭，只有冻结文件会持久化 snapshot。 */
export interface InjectState {
  name: string | null
  snapshot?: PromptSnapshot
}

/** 模板的有效正文与元信息；显示名省略或为空时使用索引 name。 */
export interface Prompt extends PromptSnapshot {
  name: string
}

/** 会话伴随文件 v1。开启必须有正文，关闭禁止附带正文，未知字段在宿主 schema 拒绝。 */
export interface FrozenSession {
  /** 冻结文件格式版本；不进行隐式迁移。 */
  version: 1

  /** 明确开启或关闭的冻结结果；开启必须保存独立正文。 */
  state: InjectState

  /** 首次持久化冻结结果的时间；继承时保留原冻结时间。 */
  frozen_at: string

  /** 结果来源；独立子会话写入 parent。 */
  source: Source

  /** 首次继承的父会话标识，仅作元信息，不是恢复依赖。 */
  inherited_from?: string
}

/** 扫描出的模板文件投影；索引来自 frontmatter，file/revision 用于编辑冲突检查。 */
export interface CatalogPrompt extends Prompt {
  /** 模板文件绝对路径；只用于编辑/删除定位，不能作为选词索引。 */
  file: string

  /** 文件属于用户库还是当前工程库。 */
  scope: Scope

  /** 本文件内容指纹，写操作提交前再次核验。 */
  revision: string

  /** 当前扫描范围内是否存在重复 name；冲突时不允许新选择。 */
  conflict: boolean
}

/** 宿主统一解析后的展示与护栏输入，前端不能自行推导可编辑性或开启状态。 */
export interface ResolvedState {
  /** 最终选择及解析/冻结正文；关闭时只包含 name:null。 */
  state: InjectState

  /** on 为有效正文，off 为关闭，invalid 为缺失、冲突或恢复错误。 */
  status: 'on' | 'off' | 'invalid'

  /** 最终选择来自哪里，与模板文件所在范围相互独立。 */
  source: Source

  /** 宿主是否允许改选；已冻结或恢复失败时为 false。 */
  editable: boolean

  /** 失效/恢复失败的可展示原因，正常状态省略。 */
  message?: string
}

/** 只读快照来源文案；不参与解析或授权。 */
export const SOURCE_LABELS: Record<Source, string> = {
  session: '本会话选择',
  parent: '继承父会话',
  none: '未开启',
}

/** 破甲词索引规则：大小写敏感，允许字母、数字、点、连字符和下划线，且不能为 . 或 ..。 */
export function isValidPromptName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 120 &&
    /^[A-Za-z0-9._-]+$/.test(name) &&
    name !== '.' &&
    name !== '..'
  )
}

/** 客户端与共享层复用的轻量表单校验；保存时仍由宿主 Zod schema 做权威复核。 */
export function validatePromptInput(input: Prompt): Prompt | null {
  if (
    !isValidPromptName(input.name) ||
    input.display_name.length > 120 ||
    input.description.length > 500 ||
    input.body.length < 1 ||
    input.body.length > 200_000 ||
    !input.body.trim()
  ) {
    return null
  }
  return {
    name: input.name,
    display_name: input.display_name || input.name,
    description: input.description,
    body: input.body,
  }
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

/** 验证正文是完整系统首段：允许系统仅含正文，或正文后以双换行连接 DSH 后续段落。 */
export function prefixMatches(system: string, body: string): boolean {
  return system === body || system.startsWith(body + '\n\n')
}
