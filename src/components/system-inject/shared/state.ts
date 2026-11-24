export type Scope = 'user' | 'workspace'
export type Source = 'session' | 'parent' | 'none'

interface PromptSnapshot {
  display_name: string
  description: string
  body: string
}

export interface InjectState {
  name: string | null
  snapshot?: PromptSnapshot
}

export interface Prompt extends PromptSnapshot {
  name: string
}

export interface FrozenSession {
  version: 1
  state: InjectState
  frozen_at: string
  source: Source
  inherited_from?: string
}

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
  session: '本会话选择',
  parent: '继承父会话',
  none: '未开启',
}

function isValidPromptName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 120 &&
    /^[A-Za-z0-9._-]+$/.test(name) &&
    name !== '.' &&
    name !== '..'
  )
}

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

export function resolveState(input: {
  session?: InjectState
  frozen?: FrozenSession
  prompts: CatalogPrompt[]
  errors?: string[]
}): ResolvedState {
  if (input.frozen) {
    return {
      state: input.frozen.state,
      status: input.frozen.state.name === null ? 'off' : 'on',
      source: input.frozen.source,
      editable: false,
    }
  }

  const state: InjectState = { name: input.session?.name ?? null }
  const source: Source = state.name === null ? 'none' : 'session'
  const result = { state, source, editable: true }

  if (state.name === null) return { ...result, status: 'off' }
  if (input.errors?.length)
    return { ...result, status: 'invalid', message: input.errors.join('；') }

  const matches = input.prompts.filter((prompt) => prompt.name === state.name)
  if (matches.length !== 1 || matches[0]?.conflict) {
    return {
      ...result,
      status: 'invalid',
      message: matches.length ? `破甲词名称冲突：${state.name}` : `破甲词已失效：${state.name}`,
    }
  }

  const { display_name, description, body } = matches[0]
  return {
    ...result,
    state: { ...state, snapshot: { display_name, description, body } },
    status: 'on',
  }
}

export function stateLabel(result: ResolvedState): string {
  if (result.status === 'invalid') return `${result.state.name ?? '破甲配置'} · 已失效`
  return result.status === 'off' ? '未破甲' : result.state.snapshot!.display_name
}

export function prefixMatches(system: string, body: string): boolean {
  return system === body || system.startsWith(body + '\n\n')
}
