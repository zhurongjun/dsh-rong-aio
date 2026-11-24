import { randomUUID } from 'node:crypto'
import { open, readFile, lstat, mkdir, rename, unlink, link } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fingerprint } from '../../../host/http.ts'

export function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

interface FileVersion {
  text?: string
  revision: string
}

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

export async function writeVersion(path: string, text: string, expected: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  if ((await readVersion(path)).revision !== expected) {
    throw new Error('文件已在其他窗口或编辑器中修改，请刷新后重试')
  }

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

    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    }
  } finally {
    await unlink(temp).catch((error: unknown) => {
      if (!missing(error)) throw error
    })
  }
}

export async function removeVersion(path: string, expected: string): Promise<void> {
  if ((await readVersion(path)).revision !== expected) throw new Error('文件已修改，请刷新后重试')
  await unlink(path)
}

async function reclaimIfDead(path: string): Promise<boolean> {
  const owner = await readFile(path, 'utf8').catch(() => '')
  const pid = Number(owner.split(':')[0])
  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) return false
  }

  if ((await readFile(path, 'utf8').catch(() => '')) !== owner) return false
  await unlink(path).catch((error: unknown) => {
    if (!missing(error)) throw error
  })
  return true
}

async function acquireLock(directory: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true })
  const path = join(directory, '.system-inject.lock')
  const start = Date.now()
  const token = `${process.pid}:${randomUUID()}`

  while (true) {
    try {
      const file = await open(path, 'wx', 0o600)
      try {
        await file.writeFile(token)
      } finally {
        await file.close()
      }
      return async () => {
        if ((await readFile(path, 'utf8').catch(() => '')) === token) await unlink(path)
      }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
      if (await reclaimIfDead(path)) continue
      if (Date.now() - start > 5000) throw new Error(`文件正在由其他进程写入：${directory}`)
      await delay(30)
    }
  }
}

export async function withFileLocks<T>(
  directories: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const releases: (() => Promise<void>)[] = []
  try {
    for (const directory of [...new Set(directories)].sort()) {
      releases.push(await acquireLock(directory))
    }
    return await operation()
  } finally {
    for (const release of releases.reverse()) await release()
  }
}
