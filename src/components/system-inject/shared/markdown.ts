/** Markdown 与破甲词对象的转换；frontmatter 提供索引，正文保持字面语义。 */

import { parseDocument, stringify } from 'yaml'
import { promptSchema, type Prompt } from './state.ts'

/** Markdown 是存储格式，不以文件名补全索引；额外 OMP 字段不参与执行。 */
export function importMarkdown(text: string): Prompt {
  if (text.length > 210_000) throw new Error('文件过大（正文最多 200,000 字符）')
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized)
  if (!match) throw new Error('缺少 Markdown 元信息（必须包含 name）')
  const document = parseDocument(match[1], { uniqueKeys: true })
  if (document.errors.length) throw new Error('Markdown 元信息格式无效')
  const data: unknown = document.toJS({ maxAliasCount: 20 })
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('元信息必须是对象')
  const parsed = promptSchema.safeParse({
    name: Reflect.get(data, 'name'),
    display_name: Reflect.get(data, 'display_name'),
    description: Reflect.get(data, 'description'),
    body: normalized.slice(match[0].length),
  })
  if (!parsed.success) throw new Error('破甲词格式无效：请检查 name、display_name、简介和正文')
  return parsed.data
}

/** 只序列化受支持的元信息并追加原样正文；导出的 name 是索引，显示名不替代它。 */
export function exportMarkdown(prompt: Prompt): string {
  return `---\n${stringify({ name: prompt.name, display_name: prompt.display_name, description: prompt.description })}---\n${prompt.body}`
}
