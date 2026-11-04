import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { importMarkdown } from '../shared/markdown.ts'
import type { CatalogPrompt, Prompt, Scope } from '../shared/state.ts'
import { fingerprint, message, missing, readVersion } from './files.ts'
import type { Paths } from './paths.ts'

/** 每次扫描读取文件指纹，只有内容变化时才重新解析 YAML；缓存不是数据源。 */
export class PromptCatalog {
  private readonly cache = new Map<string, { revision: string; prompt?: Prompt; error?: string }>()
  private readonly paths: Paths
  constructor(paths: Paths) {
    this.paths = paths
  }
  async scan(
    workspace = '',
  ): Promise<{ prompts: CatalogPrompt[]; errors: string[]; revision: string }> {
    const prompts: CatalogPrompt[] = []
    const errors: string[] = []
    const versions: string[] = []
    const scopes: Scope[] = workspace ? ['user', 'workspace'] : ['user']
    for (const scope of scopes) {
      const directory = this.paths.prompts(scope, workspace)
      try {
        const entries = await readdir(directory, { withFileTypes: true })
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!entry.name.toLowerCase().endsWith('.md') || entry.isDirectory()) continue
          const file = join(directory, entry.name)
          try {
            const version = await readVersion(file)
            versions.push(file, version.revision)
            if (version.text === undefined) throw new Error('扫描期间文件被删除，请刷新')
            let parsed = this.cache.get(file)
            if (parsed?.revision !== version.revision) {
              try {
                parsed = { revision: version.revision, prompt: importMarkdown(version.text) }
              } catch (error) {
                parsed = { revision: version.revision, error: message(error) }
              }
              // 限制编辑过的历史路径占用，清空后仍可从文件重建。
              if (this.cache.size > 2048) this.cache.clear()
              this.cache.set(file, parsed)
            }
            if (parsed.error || !parsed.prompt) throw new Error(parsed.error ?? '无法解析破甲词')
            prompts.push({
              ...parsed.prompt,
              file,
              scope,
              revision: version.revision,
              conflict: false,
            })
          } catch (error) {
            errors.push(`${file}：${message(error)}`)
          }
        }
      } catch (error) {
        if (!missing(error)) errors.push(`${directory}：${message(error)}`)
      }
    }
    const counts = new Map<string, number>()
    for (const prompt of prompts) counts.set(prompt.name, (counts.get(prompt.name) ?? 0) + 1)
    for (const prompt of prompts) prompt.conflict = counts.get(prompt.name)! > 1
    return { prompts, errors, revision: fingerprint(JSON.stringify([versions, errors])) }
  }
}
