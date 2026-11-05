/** 纯模型选择规则：目录查找、明确 effort、切换时的回退档位与多词搜索。 */

import type {
  ModelCatalogModel,
  ModelProviderGroup,
  ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'

/** 目录顺序就是适配器定义的强度顺序，不创建虚拟 Default 档。 */
export function effortsOf(model: ModelCatalogModel | undefined) {
  return (model?.reasoning?.efforts ?? []).filter(
    (effort) => !['default', 'auto', 'provider-default'].includes(effort.id.toLowerCase()),
  )
}

/**
 * 仅用于用户切换模型或重置：优先声明的默认档，再选 Medium、首个非关闭档或唯一关闭档。
 * 没有明确档位时返回 undefined，不制造 Default。
 */
export function defaultEffortOf(model: ModelCatalogModel): string | undefined {
  const efforts = effortsOf(model)
  const declared = model.reasoning?.defaultEffort
  if (efforts.some((effort) => effort.id === declared)) return declared
  return (
    efforts.find((effort) => effort.id.toLowerCase() === 'medium') ??
    efforts.find((effort) => !['off', 'none', 'disabled'].includes(effort.id.toLowerCase())) ??
    efforts[0]
  )?.id
}

/** 构造切换模型的原生选择请求；模型没有档位时完全省略 reasoningEffort。 */
export function selectionFor(provider: string, model: ModelCatalogModel): ModelSelection {
  const reasoningEffort = defaultEffortOf(model)
  return {
    provider,
    model: model.id,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

/** 以 provider+model 精确查找目录对象；未选择或目录已移除时返回 undefined。 */
export function currentModelOf(
  groups: readonly ModelProviderGroup[],
  current: ModelSelection | null,
) {
  return groups
    .find((group) => group.id === current?.provider)
    ?.models.find((model) => model.id === current?.model)
}

/** 读取已有会话时保留“未明确选择”语义；只在用户切换/重置时应用回退规则。 */
export function currentEffortOf(
  model: ModelCatalogModel | undefined,
  current: ModelSelection | null,
) {
  const id = current?.reasoningEffort ?? model?.reasoning?.defaultEffort
  return effortsOf(model).find((effort) => effort.id === id)
}

/** 支持大小写无关的多词搜索，provider/model ID 只作匹配，不解析其结构。 */
export function filterModels(groups: readonly ModelProviderGroup[], query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return groups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) => {
        const text = `${group.name} ${group.id} ${model.name} ${model.id}`.toLocaleLowerCase()
        return words.every((word) => text.includes(word))
      }),
    }))
    .filter((group) => group.models.length > 0)
}
