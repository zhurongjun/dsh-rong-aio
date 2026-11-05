/** 基础文件事务：内容指纹、限量读取、原子写入和按目录排序的跨进程互斥。 */

import { createHash, randomUUID } from 'node:crypto'
import { open, readFile, lstat, mkdir, rename, unlink, link } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** 计算 UTF-8 原文的 SHA-256 内容指纹；与文件名、mtime 无关。 */
export function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 只识别 Node ENOENT；权限、损坏和其他 IO 错误必须继续传播。 */
export function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** 把未知失败转换成可呈现文本，保留 Error.message。 */
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 带内容指纹的文件读取结果，用于乐观版本校验。 */
interface FileVersion {
  /** 文件原文；仅文件不存在时省略，不把读取失败转换为空内容。 */
  text?: string

  /** 原文 SHA-256 或 missing，用于检测外部修改。 */
  revision: string
}

/**
 * 读取普通文件并限制字节数；拒绝符号链接和非文件节点。
 * 返回缺失标记或原文/指纹；大小超限、权限或读取失败均抛错。
 */
export async function readVersion(path: string, limit = 1_000_000): Promise<FileVersion> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`不是普通文件：${path}`)
    if (stat.size > limit) throw new Error(`文件过大：${path}`)
    const text = await readFile(path, 'utf8')
    if (Buffer.byteLength(text) > limit) throw new Error(`文件过大：${path}`)
    return { text, revision: fingerprint(text) }
  } catch (error) {
    if (missing(error)) return { revision: 'missing' }
    throw error
  }
}

/** 同目录暂存、fsync 后原子提交；新文件用 link 防止覆盖并发创建者。 */
export async function writeVersion(path: string, text: string, expected: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  if ((await readVersion(path)).revision !== expected)
    throw new Error('文件已在其他窗口或编辑器中修改，请刷新后重试')
  const temp = join(dirname(path), `.system-inject-${randomUUID()}.tmp`)
  try {
    const handle = await open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    if ((await readVersion(path)).revision !== expected) throw new Error('文件已修改，请刷新后重试')
    if (expected === 'missing') await link(temp, path)
    else await rename(temp, path)
    const directory = await open(dirname(path), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } finally {
    await unlink(temp).catch((error: unknown) => {
      if (!missing(error)) throw error
    })
  }
}

/** 仅在内容指纹仍等于 expected 时删除文件；调用者负责持有相应目录锁。 */
export async function removeVersion(path: string, expected: string): Promise<void> {
  if ((await readVersion(path)).revision !== expected) throw new Error('文件已修改，请刷新后重试')
  await unlink(path)
}

/** 多进程按固定路径顺序取锁。外部编辑器不受锁约束，因此提交仍要比较内容指纹。 */
export async function withFileLocks<T>(
  directories: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const releases: (() => Promise<void>)[] = []
  try {
    for (const directory of [...new Set(directories)].sort()) {
      await mkdir(directory, { recursive: true })
      const path = join(directory, '.system-inject.lock')
      const start = Date.now()
      const token = `${process.pid}:${randomUUID()}`

      // 锁文件通过 wx 原子创建；仅能证明持有进程已退出时才回收，超时不会抢占活锁。
      while (true) {
        try {
          const file = await open(path, 'wx', 0o600)
          try {
            await file.writeFile(token)
          } finally {
            await file.close()
          }
          releases.push(async () => {
            if ((await readFile(path, 'utf8').catch(() => '')) === token) await unlink(path)
          })
          break
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST')
            throw error
          const owner = await readFile(path, 'utf8').catch(() => '')
          const pid = Number(owner.split(':')[0])
          if (Number.isInteger(pid) && pid > 0) {
            try {
              process.kill(pid, 0)
            } catch (failure) {
              if (failure instanceof Error && 'code' in failure && failure.code === 'ESRCH') {
                // 仅清理确定已退出的持锁进程，不凭耗时抢占存活进程。
                if ((await readFile(path, 'utf8').catch(() => '')) === owner) {
                  await unlink(path).catch((e: unknown) => {
                    if (!missing(e)) throw e
                  })
                  continue
                }
              }
            }
          }
          if (Date.now() - start > 5000) throw new Error(`文件正在由其他进程写入：${directory}`)
          await delay(30)
        }
      }
    }
    return await operation()
  } finally {
    for (const release of releases.reverse()) await release()
  }
}
