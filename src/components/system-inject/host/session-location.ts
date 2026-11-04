import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'

/** 与 rc.5 JSONL format.ts 的磁盘编码一致；不访问后端私有 root/locate。 */
export function encodeSessionSegment(value: string): string {
  if (!value) throw new Error('会话 ID 不能为空')
  if (value === '.' || value === '..') return '~002E'.repeat(value.length)
  let result = ''
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    result += /^[A-Za-z0-9._-]$/.test(char)
      ? char
      : '~' + value.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
  }
  return result
}
export function projectKey(cwd: string): string {
  if (!cwd) throw new Error('工作区路径不能为空')
  let result = ''
  let separator = false
  for (let i = 0; i < cwd.length; i++) {
    const char = cwd[i]
    if (/[\\/:]/.test(char)) {
      if (!separator) result += '-'
      separator = true
    } else {
      result += /^[A-Za-z0-9._-]$/.test(char)
        ? char
        : '~' + cwd.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
      separator = false
    }
  }
  return `--${(result.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}
export function sessionDirectory(root: string, meta: { id: string; cwd?: string }): string {
  return join(
    root,
    meta.cwd === undefined ? '_no-cwd' : projectKey(meta.cwd),
    encodeSessionSegment(meta.id),
  )
}

/** 只接受可唯一识别的活动原生后端；自定义 root 来自 Loader 已求值并校验的配置。 */
export function sessionRoot(ctx: Context): string {
  const backend = Reflect.get(ctx, 'sessionPersistence') as { name?: string } | undefined
  if (backend?.name !== 'session-persistence-jsonl')
    throw new Error('破甲模式会话快照需要原生 JSONL 会话存储')
  const entries = [...ctx.loader.entries()].filter(
    (entry) =>
      entry.options.name === '@deepseek-ai/dsh-session-persistence-jsonl' &&
      entry.fiber?.state === 2 &&
      !entry.disabled,
  )
  if (entries.length !== 1) throw new Error('无法唯一定位活动会话存储，请检查 JSONL 后端配置')
  const root: unknown = entries[0].fiber?.config?.root
  if (typeof root !== 'string' || !root) throw new Error('会话存储缺少已解析的 root 配置')
  return resolve(root)
}
