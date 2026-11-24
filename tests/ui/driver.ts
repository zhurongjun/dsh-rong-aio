import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, open, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'

function launch(program: string, args: string[], options: SpawnOptions = {}) {
  const child = spawn(program, args, {
    windowsHide: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    ...options,
  })
  const done = new Promise<void>((resolveDone, rejectDone) => {
    child.once('error', rejectDone)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveDone()
      else rejectDone(new Error(`${program} exited with ${code ?? signal}`))
    })
  })
  done.catch(() => {})
  return { child, done }
}

async function firstExisting(candidates: Array<string | undefined>): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!candidate) continue
    const found = await access(candidate).then(
      () => true,
      () => false,
    )
    if (found) return candidate
  }
  return undefined
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
}

export async function runBombadil(
  origin: string,
  directory: string,
  fixtureRoot: string,
  signals: { testSignal: AbortSignal; stopSignal: AbortSignal },
): Promise<void> {
  const win = process.platform === 'win32'
  const trace = relative('.', join(directory, 'trace.bin')).replaceAll('\\', '/')
  console.log('Bombadil trace:', trace)

  const flags = [
    '--exit-on-violation',
    '--time-limit',
    process.env.CI === 'true' ? '60s' : '20s',
    '--width',
    '1024',
    '--height',
    '768',
    '--device-scale-factor',
    '1',
    '--output-path',
    trace,
    origin,
    'tests/ui/ui.spec.mjs',
  ]

  const binary = `node_modules/@antithesishq/bombadil/binaries/bombadil-${win ? 'linux' : process.platform}-${process.arch}`

  async function testBrowser(
    program: string,
    args: string[],
    options: SpawnOptions = {},
  ): Promise<void> {
    const file = join(directory, 'bombadil.log')
    const log = await open(file, 'w')
    const run = launch(program, args, { stdio: ['ignore', log.fd, log.fd], ...options })

    const onTestAbort = () => void terminate(run.child)
    const onStopAbort = () => void terminate(run.child)
    signals.testSignal.addEventListener('abort', onTestAbort, { once: true })
    signals.stopSignal.addEventListener('abort', onStopAbort, { once: true })

    try {
      if (signals.testSignal.aborted || signals.stopSignal.aborted) {
        await terminate(run.child)
      }
      await run.done
    } catch (error) {
      if (signals.stopSignal.aborted && !signals.testSignal.aborted) return
      const output = await readFile(file, 'utf8')
      throw new Error(output.trim().split(/\r?\n/).slice(-20).join('\n'), { cause: error })
    } finally {
      signals.testSignal.removeEventListener('abort', onTestAbort)
      signals.stopSignal.removeEventListener('abort', onStopAbort)
      await log.close()
    }
  }

  if (!win) {
    let env: NodeJS.ProcessEnv | undefined
    if (!process.env.CHROME) {
      const candidates =
        process.platform === 'darwin'
          ? [
              '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              '/Applications/Chromium.app/Contents/MacOS/Chromium',
              '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            ]
          : [
              '/usr/bin/google-chrome',
              '/usr/bin/google-chrome-stable',
              '/usr/bin/chromium',
              '/usr/bin/chromium-browser',
            ]
      const candidate = await firstExisting(candidates)
      if (candidate) env = { ...process.env, CHROME: candidate }
    }
    await testBrowser(
      binary,
      ['browser', 'test', '--headless', ...flags],
      env ? { env } : undefined,
    )
    return
  }

  const chrome = await firstExisting([
    process.env.CHROME_PATH,
    ...['PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'].flatMap((key) =>
      ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'].map((p) =>
        join(process.env[key] ?? '', p),
      ),
    ),
  ])
  if (!chrome) throw new Error('Set CHROME_PATH to a Chromium browser')

  const profile = resolve(fixtureRoot, 'browser-profile')
  await mkdir(profile)
  const browser = launch(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--window-size=1024,768',
      '--force-device-scale-factor=1',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let relay: ReturnType<typeof launch> | undefined
  try {
    let port = 0
    for (let i = 0; i < 100 && !port; i++) {
      await Promise.race([
        sleep(100),
        browser.done.then(() => {
          throw new Error('Browser exited before CDP was ready')
        }),
      ])
      port = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then(
        (s) => Number(s.split('\n')[0]),
        () => 0,
      )
    }
    if (!port) throw new Error('Browser did not publish a CDP port')

    relay = launch('wsl.exe', ['--exec', 'python3', 'tests/ui/wsl-cdp.py', String(port)], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    const ready = createInterface({ input: relay.child.stdout! })
    try {
      await Promise.race([
        once(ready, 'line', { signal: AbortSignal.timeout(15000) }),
        relay.done.then(() => {
          throw new Error('WSL CDP relay exited')
        }),
      ])
    } finally {
      ready.close()
    }

    await testBrowser('wsl.exe', [
      '--exec',
      binary,
      'browser',
      'test-external',
      '--remote-debugger',
      'http://127.0.0.1:' + port,
      '--create-target',
      ...flags,
    ])
  } finally {
    relay?.child.stdin?.end()
    browser.child.kill()
    await Promise.allSettled([browser.done, relay?.done])
  }
}
