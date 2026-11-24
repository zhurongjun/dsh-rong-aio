import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, open, readFile, mkdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createInterface } from 'node:readline'

function launch(program, args, options = {}) {
  const child = spawn(program, args, {
    windowsHide: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    ...options,
  })
  const done = once(child, 'exit').then(([code, signal]) => {
    if (code !== 0) throw new Error(program + ' exited with ' + (code ?? signal))
  })
  done.catch(() => {})
  return { child, done }
}
export async function runBombadil(origin, directory, fixtureRoot, signal) {
  const win = process.platform === 'win32'
  const trace = relative('.', join(directory, 'trace.bin')).replaceAll('\\', '/')
  console.log('Bombadil trace:', trace)
  const flags = [
    '--exit-on-violation',
    '--time-limit',
    // Bombadil 从进程启动开始计时。CI 冷启动曾在首个场景完成前耗去约 17 秒。
    process.env.CI === 'true' ? '60s' : '20s',
    '--output-path',
    trace,
    origin,
    'tests/bombadil/ui.spec.mjs',
  ]
  const binary =
    'node_modules/@antithesishq/bombadil/binaries/bombadil-' +
    (win ? 'linux' : process.platform) +
    '-' +
    process.arch
  async function testBrowser(program, args, options = {}) {
    const file = join(directory, 'bombadil.log')
    const log = await open(file, 'w')
    try {
      await launch(program, args, { stdio: ['ignore', log.fd, log.fd], signal, ...options }).done
    } catch (error) {
      const output = await readFile(file, 'utf8')
      throw new Error(output.trim().split(/\r?\n/).slice(-20).join('\n'), { cause: error })
    } finally {
      await log.close()
    }
  }
  if (!win) {
    let env
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
      for (const candidate of candidates) {
        if (
          await access(candidate).then(
            () => true,
            () => false,
          )
        ) {
          env = { ...process.env, CHROME: candidate }
          break
        }
      }
    }
    await testBrowser(
      binary,
      ['browser', 'test', '--headless', ...flags],
      env ? { env } : undefined,
    )
    return
  }
  const candidates = [
    process.env.CHROME_PATH,
    ...['PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'].flatMap((key) =>
      ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'].map((p) =>
        join(process.env[key] ?? '', p),
      ),
    ),
  ]
  let chrome
  for (const candidate of candidates.filter(Boolean))
    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    ) {
      chrome = candidate
      break
    }
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
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  let relay
  try {
    let port
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
    relay = launch('wsl.exe', ['--exec', 'python3', 'tests/bombadil/wsl-cdp.py', String(port)], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    const ready = createInterface({ input: relay.child.stdout })
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
    relay?.child.stdin.end()
    browser.child.kill()
    await Promise.allSettled([browser.done, relay?.done])
  }
}
