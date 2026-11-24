import type {
  ModelCatalogModel,
  ModelProviderGroup,
  ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { matchesQueryWords } from '../../../shared/model-search.ts'

export function effortsOf(model: ModelCatalogModel | undefined) {
  return (model?.reasoning?.efforts ?? []).filter(
    (effort) => !['default', 'auto', 'provider-default'].includes(effort.id.toLowerCase()),
  )
}

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

export function selectionFor(provider: string, model: ModelCatalogModel): ModelSelection {
  const reasoningEffort = defaultEffortOf(model)
  return {
    provider,
    model: model.id,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

export function currentModelOf(
  groups: readonly ModelProviderGroup[],
  current: ModelSelection | null,
) {
  return groups
    .find((group) => group.id === current?.provider)
    ?.models.find((model) => model.id === current?.model)
}

export function currentEffortOf(
  model: ModelCatalogModel | undefined,
  current: ModelSelection | null,
) {
  const id = current?.reasoningEffort ?? model?.reasoning?.defaultEffort
  return effortsOf(model).find((effort) => effort.id === id)
}

export function buildModelCatalog(groups: readonly ModelProviderGroup[], query: string) {
  const filtered = groups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        matchesQueryWords(`${group.name} ${group.id} ${model.name} ${model.id}`, query),
      ),
    }))
    .filter((group) => group.models.length > 0)

  const rows = filtered.flatMap((group) => group.models.map((model) => ({ group, model })))
  let offset = 0
  const indexed = filtered.map((group) => {
    const entry = { group, offset }
    offset += group.models.length
    return entry
  })

  return { groups: indexed, rows }
}
