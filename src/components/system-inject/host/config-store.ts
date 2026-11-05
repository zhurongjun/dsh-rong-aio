/** 用户白名单配置：严格校验格式，缓存解析结果但每次重新读取内容指纹。 */

import { z } from 'zod'
import { routeSchema } from '../shared/protocol.ts'
import { message, readVersion, writeVersion } from './files.ts'
import type { Paths } from './paths.ts'

// 配置只维护用户白名单；不接受未定义字段，避免拼写错误被静默忽略。
const userConfigSchema = z
  .object({
    version: z.literal(1),
    whitelist: z.array(routeSchema).default([]),
  })
  .strict()

type UserConfig = z.infer<typeof userConfigSchema>

/** 配置读取结果，将内容版本与诊断一起交给调用者。 */
interface ConfigFile {
  /** 原文件内容指纹；缺失为 missing，无法读取为 unreadable。 */
  revision: string

  /** 已校验配置；读取失败时仅携带保守空值，调用者仍须检查 error。 */
  value: UserConfig

  /** 包含路径的读取/解析诊断，不能按未配置处理。 */
  error?: string
}

/**
 * 管理唯一用户 config.json 的格式校验、版本读取与原子保存。
 *
 * 文件是数据源，缓存只避免重复 JSON/Zod 解析；每次请求仍重新读取内容指纹。
 * 缺失文件返回有效空白名单，读取/解析失败返回诊断；调用者必须先检查 error。
 */
export class ConfigStore {
  /** 固定用户配置路径；本 store 不处理工程授权。 */
  private readonly paths: Paths

  /** 最近一次成功解析缓存；每次仍重新读取文件并比较指纹。 */
  private parsed?: ConfigFile

  /** 绑定用户配置位置，不立即读取文件。 */
  constructor(paths: Paths) {
    this.paths = paths
  }

  /** 返回脱离缓存的配置副本；缺失视为空配置，读取或格式失败必须携带 error。 */
  async read(): Promise<ConfigFile> {
    const path = this.paths.config()
    const empty: UserConfig = { version: 1, whitelist: [] }
    let revision = 'unreadable'
    try {
      const file = await readVersion(path)
      revision = file.revision
      if (file.text === undefined) return { revision, value: empty }

      // 每次仍读取文件并比对内容指纹；只复用解析结果，不让界面缓存影响请求校验。
      if (this.parsed?.revision === revision) return structuredClone(this.parsed)
      const raw: unknown = JSON.parse(file.text)
      const value = userConfigSchema.parse(raw)
      this.parsed = { revision, value }
      return structuredClone(this.parsed)
    } catch (error) {
      return { revision, value: empty, error: `${path}：${message(error)}` }
    }
  }

  /** 校验当前配置格式并按 expected 指纹原子保存；版本冲突或写盘失败向上传递。 */
  async save(value: UserConfig, expected: string): Promise<void> {
    const data = userConfigSchema.parse(value)
    await writeVersion(this.paths.config(), JSON.stringify(data, null, 2) + '\n', expected)
  }
}
