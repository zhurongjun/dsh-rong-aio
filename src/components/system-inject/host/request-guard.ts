import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Controller } from './controller.ts'

function systemText(options: GenerateOptions): string {
  if (options.system !== undefined) return options.system
  const first = options.messages[0]
  return first?.role === 'system'
    ? first.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    : ''
}
/** 唯一实际路由护栏。预览、选模和 agent/request 的初始配置都不在这里冒充实际请求。 */
export async function guardRequest(
  controller: Controller,
  options: GenerateOptions,
): Promise<void> {
  const id = options.sessionId
  if (!id || !controller.sessions.entries.has(id)) return
  try {
    const body = controller.body(id)
    const text = systemText(options)
    // 标题仅在完全不携带注入正文时独立运行；压缩等辅助请求仍经过同一护栏。
    if (
      options.purpose === 'session-title' &&
      (!body ||
        (!text.includes(body) &&
          !options.messages.some((item) =>
            item.content.some((part) => part.type === 'text' && part.text.includes(body)),
          )))
    )
      return
    await controller.admit(id, options, text, !options.purpose)
  } catch (error) {
    throw controller.fail(id, error, { provider: options.provider, model: options.model })
  }
}
