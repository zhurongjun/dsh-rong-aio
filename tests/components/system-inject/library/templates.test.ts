/** 真实文件系统上的模板索引、文件编辑、版本校验及跨进程写入。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, prompt } from '../helpers/fixture.ts'
import {
  importMarkdown,
  exportMarkdown,
} from '../../../../src/components/system-inject/shared/markdown.ts'
import { resolveState } from '../../../../src/components/system-inject/shared/state.ts'

test('Markdown 必须提供 name，显示名回退，正文不展开变量；重命名文件不改变索引', async (t) => {
  assert.deepEqual(importMarkdown(exportMarkdown(prompt)), prompt)
  assert.equal(importMarkdown('---\nname: v1\nstatus: ignored\n---\nBODY').display_name, 'v1')
  for (const text of [
    'BODY',
    '---\nname: 中文\n---\nBODY',
    '---\nname: ..\n---\nBODY',
    '---\nname: a\nname: b\n---\nBODY',
  ])
    assert.throws(() => importMarkdown(text))
  const f = await fixture(t)
  const file = await f.put()
  await rename(file, join(f.paths.prompts('user'), 'renamed.md'))
  assert.equal((await f.controller.context()).config.templates[0].name, prompt.name)
})

test('只扫描直属 Markdown；用户和工程同名冲突，损坏文件明确报错', async (t) => {
  const f = await fixture(t)
  await f.put()
  await mkdir(join(f.paths.prompts('user'), 'nested'))
  await writeFile(
    join(f.paths.prompts('user'), 'nested/ignored.md'),
    exportMarkdown({ ...prompt, name: 'nested' }),
  )
  await f.put({ ...prompt, display_name: '工程同名' }, 'workspace')
  let { config } = await f.controller.context(f.workspace)
  assert.equal(config.templates.length, 2)
  assert.ok(config.templates.every((item) => item.conflict))
  assert.equal(
    resolveState({ session: { name: prompt.name }, prompts: config.templates }).status,
    'invalid',
  )
  await writeFile(join(f.paths.prompts('user'), 'broken.md'), 'missing metadata')
  config = (await f.controller.context(f.workspace)).config
  assert.match(config.errors.join(), /broken.md/)
})

test('跨进程文件版本拒绝覆盖；改名和删除允许确认后产生失效引用', async (t) => {
  const f = await fixture(t)
  const file = await f.put()
  await f.configure()
  await f.select()
  let { config } = await f.controller.context(f.workspace)
  await f.put({ ...prompt, display_name: '外部修改' })
  await assert.rejects(
    f.controller.command(
      { type: 'save-template', scope: 'user', file, template: prompt, revision: config.revision },
      f.workspace,
    ),
    /已在其他/,
  )
  config = (await f.controller.context(f.workspace)).config
  await assert.rejects(
    f.controller.command({ type: 'delete-template', file, revision: config.revision }, f.workspace),
    /请确认/,
  )
  await f.controller.command(
    {
      type: 'save-template',
      scope: 'user',
      file,
      template: { ...prompt, name: 'new-name' },
      revision: config.revision,
      confirmed: true,
    },
    f.workspace,
  )
  assert.equal((await f.controller.view('s')).session!.resolved.status, 'invalid')
  assert.equal(importMarkdown(await readFile(file, 'utf8')).name, 'new-name')
  config = (await f.controller.context(f.workspace)).config
  await f.controller.command(
    { type: 'delete-template', file, revision: config.revision, confirmed: true },
    f.workspace,
  )
  assert.equal((await f.controller.context(f.workspace)).config.templates.length, 0)
})

test('两个进程写同一配置只接受一个版本，另一个报告冲突而非覆盖', async (t) => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { pathToFileURL } = await import('node:url')
  const { resolve } = await import('node:path')
  const { readVersion } = await import('../../../../src/components/system-inject/host/files.ts')
  const f = await fixture(t)
  await f.configure()
  const path = f.paths.config()
  const before = await readVersion(path)
  const moduleUrl = pathToFileURL(resolve('src/components/system-inject/host/files.ts')).href
  const script = `import { withFileLocks, writeVersion } from ${JSON.stringify(moduleUrl)};
    const [directory, path, revision, value] = process.argv.slice(1);
    try { await withFileLocks([directory], () => writeVersion(path, value, revision)); process.stdout.write('saved') }
    catch { process.stdout.write('conflict') }`
  const run = promisify(execFile)
  const results = await Promise.all(
    ['ONE', 'TWO'].map((value) =>
      run(process.execPath, [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        script,
        f.paths.user,
        path,
        before.revision,
        value,
      ]),
    ),
  )
  assert.deepEqual(results.map((item) => item.stdout).sort(), ['conflict', 'saved'])
  assert.ok(['ONE', 'TWO'].includes(await readFile(path, 'utf8')))
})
