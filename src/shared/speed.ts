export type SpeedMode = 'standard' | 'fast' | 'ultrafast'

export const SPEED_LABELS: Record<SpeedMode, string> = {
  standard: '标准',
  fast: '快速',
  ultrafast: '超快',
}

export interface SpeedRule {
  family: 'openai' | 'anthropic'
  models: readonly string[]
  modes: readonly SpeedMode[]
  beta?: string
}

// 人工维护的允许列表，核对日期 2026-11-04；新增型号必须核对官方 API 支持。
// 不使用 gpt-* / claude-* 宽泛匹配，也不把名称当成账户权限保证。
export const SPEED_RULES: readonly SpeedRule[] = [
  {
    family: 'openai',
    models: ['gpt-6-astra', 'gpt-6.1-sol'],
    modes: ['standard', 'fast', 'ultrafast'],
  },
  {
    family: 'openai',
    models: ['gpt-5.6-sol', 'gpt-6-sol', 'gpt-6.1-terra', 'gpt-6-luna'],
    modes: ['standard', 'fast'],
  },
  { family: 'anthropic', models: ['claude-opus-5-5'], modes: ['standard', 'fast'] },
  {
    family: 'anthropic',
    models: ['claude-opus-5', 'claude-opus-4-8'],
    modes: ['standard', 'fast'],
    beta: 'fast-mode-2026-02-01',
  },
]

function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s._]+/g, '-')
    .replace(/-+/g, '-')
}

export function speedRuleFor(model: string, displayName?: string): SpeedRule | undefined {
  const names = [model, displayName].filter((name): name is string => !!name).map(normalize)
  return SPEED_RULES.find((rule) =>
    rule.models.some((id) =>
      names.some((name) => {
        const canonical = normalize(id)
        return name === canonical || new RegExp(`^${canonical}-\\d{4}-?\\d{2}-?\\d{2}$`).test(name)
      }),
    ),
  )
}

export interface SpeedIdentity {
  sessionId: string
  provider: string
  model: string
}
export interface SpeedState {
  reason?: string
  mode: SpeedMode
  modes: readonly SpeedMode[]
}
export function speedKey(identity: SpeedIdentity): string {
  return JSON.stringify([identity.sessionId, identity.provider, identity.model])
}
