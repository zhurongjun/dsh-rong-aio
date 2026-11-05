/** Fast 的公开数据契约与人工型号允许列表；协议支持仍由宿主进一步限制。 */

/** 客户端与宿主共享的速度档位标识；standard 会显式映射到协议的标准字段。 */
export type SpeedMode = 'standard' | 'fast' | 'ultrafast'

/** 速度档位的中文展示文案，不作为协议字段发送。 */
export const SPEED_LABELS: Record<SpeedMode, string> = {
  standard: '标准',
  fast: '快速',
  ultrafast: '超快',
}

/** 一个已核对型号组的速度能力；宿主还会按连接协议裁剪 modes。 */
export interface SpeedRule {
  /** 决定请求字段和允许的协议族，不能从任意 provider 名称推断。 */
  family: 'openai' | 'anthropic'

  /** 人工核对的规范型号列表，禁止宽泛家族通配。 */
  models: readonly string[]

  /** 该规则允许的档位；最终仍受实际 HTTP 协议约束。 */
  modes: readonly SpeedMode[]

  /** Anthropic 快速档需要附加的 beta 标记；没有时不添加。 */
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

/** 统一展示名/模型 ID 的空格和常见分隔符，供人工列表匹配；不改变请求中的实际 ID。 */
function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s._]+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * 匹配人工规则或其日期版本后缀，未知型号返回 undefined。
 * 显示名只是候选别名；宿主传入的显示名必须来自自身解析出的模型目录。
 */
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

/** 速度持久化身份；同名模型在不同提供商或会话下互不影响。 */
export interface SpeedIdentity {
  /** DSH 原生会话 ID。 */
  sessionId: string

  /** 实际提供商 ID，不使用显示名。 */
  provider: string

  /** 实际模型 ID，作为请求匹配依据。 */
  model: string
}

/** 宿主确认的速度与能力集合；空 modes 表示当前不可操作。 */
export interface SpeedState {
  /** 不可用时的说明；不参与档位判断。 */
  reason?: string

  /** 已持久化并且当前协议仍支持的选中档位。 */
  mode: SpeedMode

  /** 宿主结合型号和连接协议确认的可选档位。 */
  modes: readonly SpeedMode[]
}

/** 用 JSON 数组编码完整身份，避免分隔符出现在 ID 内时产生键碰撞。 */
export function speedKey(identity: SpeedIdentity): string {
  return JSON.stringify([identity.sessionId, identity.provider, identity.model])
}
