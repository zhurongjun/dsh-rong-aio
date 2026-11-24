import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { findActiveEntries } from './dsh-adapter.ts'

function encodeChar(char: string): string {
  return /^[A-Za-z0-9._-]$/.test(char)
    ? char
    : '~' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')
}

function encodeSessionSegment(value: string): string {
  if (!value) throw new Error('会话 ID 不能为空')
  if (value === '.' || value === '..') return '~002E'.repeat(value.length)

  let result = ''
  for (const char of value) result += encodeChar(char)
  return result
}

function projectKey(cwd: string): string {
  if (!cwd) throw new Error('工作区路径不能为空')

  let result = ''
  let separator = false
  for (const char of cwd) {
    if (/[\\/:]/.test(char)) {
      if (!separator) result += '-'
      separator = true
    } else {
      result += encodeChar(char)
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

export function sessionRoot(ctx: Context): string {
  const backend = Reflect.get(ctx, 'sessionPersistence') as { name?: string } | undefined
  if (backend?.name !== 'session-persistence-jsonl')
    throw new Error('此操作需要原生 JSONL 会话存储')

  const entries = findActiveEntries(ctx, '@deepseek-ai/dsh-session-persistence-jsonl')
  if (entries.length !== 1) throw new Error('无法唯一定位活动会话存储，请检查 JSONL 后端配置')

  const config: unknown = entries[0].fiber?.effectiveConfig
  const root =
    typeof config === 'object' && config !== null && 'root' in config ? config.root : undefined
  if (typeof root !== 'string' || !root) throw new Error('会话存储缺少已解析的 root 配置')

  return resolve(root)
}
