// Real Electron regression checks. Never installs or invokes a real mise binary.
const { _electron, expect } = require('@playwright/test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

async function main() {
  const temp = mkdtempSync(join(tmpdir(), 'mise-gui-desktop-'))
  const absent = join(temp, 'missing-mise.exe')
  const errors = []
  const artifacts = resolve('test-results')
  mkdirSync(artifacts, { recursive: true })
  let app
  let checks = 0
  const check = async (name, fn) => {
    await fn()
    console.log(`✓ ${name}`)
    checks++
  }
  try {
    // A separate profile prevents language/theme checks from touching user prefs.
    const env = { ...process.env, MISE_BIN: absent, APPDATA: temp, XDG_CONFIG_HOME: temp }
    delete env.VITE_DEV_SERVER_URL
    delete env.ELECTRON_RUN_AS_NODE
    const packagedExecutable = process.env.MISE_GUI_TEST_EXECUTABLE
    app = await _electron.launch({
      ...(packagedExecutable ? { executablePath: resolve(packagedExecutable) } : {}),
      args: [...(packagedExecutable ? [] : [resolve('.')]), `--user-data-dir=${join(temp, 'chromium')}`],
      env,
    })
    const page = await app.firstWindow()
    page.setDefaultTimeout(10000)
    page.on('pageerror', e => errors.push(e.message))
    await page.evaluate(() => { localStorage.setItem('mise-gui.lang', 'zh') })
    await page.reload()
    const missing = page.getByRole('heading', { name: '未检测到 mise', exact: true })
    await check('cold start resolves to missing state', () => expect(missing).toBeVisible())
    await check('profile is isolated', async () => {
      const path = await app.evaluate(({ app }) => app.getPath('userData'))
      assert.ok(path.startsWith(temp), path)
    })
    await check('renderer is sandboxed and cannot open windows or navigate away', async () => {
      const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences())
      assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false)
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
      const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
      await page.evaluate(() => window.open('https://example.com'))
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), count)
      const before = page.url()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.once('will-navigate', event => {
        globalThis.testNavigationBlocked = event.defaultPrevented
      }))
      await page.evaluate(() => { location.href = 'https://example.com' })
      await expect.poll(() => app.evaluate(() => globalThis.testNavigationBlocked)).toBe(true)
      assert.equal(page.url(), before)
      // Reset Chromium's cancelled-navigation lifecycle before later locator
      // actions; the original page remains the only permitted entry point.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.stop())
      await page.reload()
      await expect(missing).toBeVisible()
    })
    await check('malformed streamed IPC resolves with one failure exit and never launches a command', async () => {
      const result = await page.evaluate(async () => {
        const events = []
        const result = await window.mise.install('--help', '1', { pin: false }, event => events.push(event))
        return { result, events }
      })
      assert.equal(result.result.ok, false)
      assert.match(result.result.stderr, /Invalid tool/)
      assert.equal(result.events.filter(event => event.type === 'exit').length, 1)
      assert.equal(result.events.at(-1).code, -1)
    })
    await check('collapsed sidebar popover opens both destinations and settings omit removed rows', async () => {
      const sidebar = page.locator('.sidebar')
      await expect(sidebar.locator('.quick-toggle')).toHaveCount(2)
      await page.getByRole('button', { name: '收起侧边栏', exact: true }).click()
      const more = sidebar.getByRole('button', { name: '更多操作', exact: true })
      const popover = sidebar.locator('.sidebar-more-popover')
      await expect(sidebar.locator('.quick-toggle')).toHaveCount(1)
      await more.click()
      await expect(popover.getByRole('button')).toHaveCount(2)
      await expect(more).toHaveAttribute('aria-expanded', 'true')
      await expect.poll(() => sidebar.evaluate(el => el.getBoundingClientRect().width)).toBe(56)
      await expect(page.locator('.cmd-tip')).toHaveCount(0)
      for (const button of await popover.getByRole('button').all()) {
        assert.ok(await button.evaluate(el => {
          const r = el.getBoundingClientRect()
          return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
        }), 'popover button must be visible and unobstructed')
      }
      await page.screenshot({ path: join(artifacts, 'sidebar-more.png') })
      await more.click()
      await expect(popover).toHaveCount(0)
      await more.click()
      await page.keyboard.press('Escape')
      await expect(popover).toHaveCount(0)
      await expect(more).toBeFocused()
      await page.keyboard.press('Enter')
      await page.locator('.topbar h1').click()
      await expect(popover).toHaveCount(0)
      await more.click()
      await popover.getByRole('button', { name: '文档中心', exact: true }).click()
      await expect(page.locator('.docs-layout')).toBeVisible()
      await expect(popover).toHaveCount(0)
      await more.click()
      await popover.getByRole('button', { name: '设置', exact: true }).click()
      await expect(page.locator('.settings-page')).toBeVisible()
      await expect(popover).toHaveCount(0)
      await page.getByRole('button', { name: 'mise 管理', exact: true }).click()
      await expect(page.locator('.settings-page .sp-row')).toHaveCount(1)
      await expect(page.locator('.settings-page')).not.toContainText('默认工作目录')
      await expect(page.locator('.settings-page')).not.toContainText('全局配置文件')
      await page.getByRole('button', { name: '返回应用', exact: true }).click()
      await more.click()
      await page.getByRole('button', { name: '展开侧边栏', exact: true }).click()
      await expect(popover).toHaveCount(0)
      await expect(sidebar.locator('.quick-toggle')).toHaveCount(2)
      await sidebar.getByRole('button', { name: '工具管理', exact: true }).click()
    })
    await app.evaluate((_, node) => {
      const cp = process.getBuiltinModule('child_process')
      const spawn = cp.spawn
      globalThis.testNode = node
      globalThis.testInstallerLaunches = 0
      globalThis.testCommands = []
      cp.spawn = (...args) => {
        globalThis.testCommands.push(args[1])
        if (args[0] === 'powershell.exe' || args[0] === 'sh') {
          if (!globalThis.testInstallMode) throw new Error('Real installer blocked by regression test')
          globalThis.testInstallerLaunches++
          if (args[2].timeout !== 1200000) throw new Error('Installer must have a timeout')
          if (globalThis.testInstallMode === 'spawn-error') throw new Error('TEST_INSTALLER_SPAWN_ERROR')
          if (globalThis.testInstallMode === 'enoent') return spawn('Z:/test-missing-installer.exe', [], args[2])
          if (globalThis.testInstallMode === 'timeout') return spawn(node,
            ['-e', 'console.error("mise: installing mise..."); setTimeout(() => {}, 60000)'], { ...args[2], timeout: 250 })
          const success = globalThis.testInstallMode === 'success'
          const code = success || globalThis.testInstallMode === 'noop' ? 0 : 17
          if (success) { process.env.MISE_BIN = node; globalThis.testHealthy = true }
          return spawn(node, ['-e', `console.log('TEST_INSTALL_PROGRESS'); setTimeout(() => {
            if (${code}) console.error('TEST_DOWNLOAD_FAILED'); process.exit(${code});
          }, 800)`], args[2])
        }
        if (globalThis.testStall && args[1]?.[0] === '--version') {
          return spawn(globalThis.testNode, ['-e', 'setTimeout(() => {}, 60000)'], args[2])
        }
        if (globalThis.testHealthy && args[0] === globalThis.testNode && args[1]?.[0] !== '--version') {
          if (globalThis.testDoctorDirs && args[1]?.[0] === 'doctor') {
            return spawn(globalThis.testNode, ['-e', 'console.log(' + JSON.stringify(JSON.stringify({ dirs: globalThis.testDoctorDirs })) + ')'], args[2])
          }
          return spawn(globalThis.testNode, ['-e', 'console.log("{}")'], args[2])
        }
        return spawn(...args)
      }
    }, process.execPath)
    await check('no endless loading or unusable add button', async () => {
      await expect(page.locator('.topbar [aria-busy="true"]')).toHaveCount(0)
      await expect(page.locator('.content .spinner')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '+ 添加工具', exact: true })).toHaveCount(0)
      await page.screenshot({ path: join(artifacts, 'missing-dark.png') })
    })
    await check('command tooltip uses compact width and inline copy icon with feedback', async () => {
      const refresh = page.locator('.topbar').getByRole('button', { name: '刷新', exact: true })
      await refresh.hover()
      const tooltip = page.locator('.cmd-tip.cmd')
      const command = tooltip.locator('code')
      const copy = tooltip.getByRole('button', { name: '复制', exact: true })
      await expect(command).toHaveText('mise --version')
      await expect(tooltip.locator('.cmd-tip-head')).toHaveText('重新探测')
      await expect(copy.locator('svg')).toHaveCount(1)
      await expect(copy).toHaveText('')
      const box = await tooltip.boundingBox()
      const codeBox = await command.boundingBox()
      const copyBox = await copy.boundingBox()
      assert.ok(box.width < 260, 'short command should not occupy a fixed-width card')
      assert.ok(Math.abs(codeBox.y - copyBox.y) < 2, 'copy belongs on the command row')
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      assert.ok(box.x >= 7 && box.x + box.width <= viewport.width - 7)
      assert.ok(box.y >= 7 && box.y + box.height <= viewport.height - 7)
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
        configurable: true, value: { writeText: async text => { globalThis.testClipboard = text } },
      }))
      await copy.click()
      await expect(tooltip.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
      assert.equal(await page.evaluate(() => globalThis.testClipboard), 'mise --version')
      await page.screenshot({ path: join(artifacts, 'tooltip-command.png') })
      await page.evaluate(() => { delete navigator.clipboard })
      await page.locator('.topbar h1').hover()
      await expect(tooltip).toHaveCount(0)
      await page.locator('.sidebar .quick-toggle.docs').hover()
      await expect(page.locator('.cmd-tip')).toHaveCount(0)
    })
    await check('simple controls stay quiet and command tips still dismiss on Escape and blur', async () => {
      const hint = page.locator('.cmd-tip')
      const collapsed = page.locator('button.console-head')
      const collapse = () => page.locator('.console').getByRole('button', { name: '收起', exact: true }).click()
      for (const control of [
        page.locator('.sidebar .quick-toggle.settings'),
        page.locator('.topbar').getByRole('button', { name: '查看文档', exact: true }),
        page.locator('.titlebar-toggle'),
        page.locator('.win-btn').first(),
        page.locator('.nav-item').first(),
      ]) {
        await control.hover()
        await expect(hint).toHaveCount(0)
        await control.focus()
        await expect(hint).toHaveCount(0)
      }
      await expect(page.locator('button[title]')).toHaveCount(0)
      await collapse()
      await collapsed.hover()
      await expect(hint).toHaveCount(0)
      await collapsed.click()
      await expect(page.locator('.console-body')).toBeVisible()
      await expect(hint).toHaveCount(0)
      await collapse()
      await collapsed.focus()
      await expect(hint).toHaveCount(0)
      await page.keyboard.press('Enter')
      await expect(page.locator('.console-body')).toBeVisible()
      const refresh = page.locator('.topbar').getByRole('button', { name: '刷新', exact: true })
      await refresh.hover()
      await expect(hint).toContainText('mise --version')
      await page.keyboard.press('Escape')
      await expect(hint).toHaveCount(0)
      await page.mouse.move(450, 350)
      await refresh.hover()
      await expect(hint).toContainText('mise --version')
      await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await expect(hint).toHaveCount(0)
    })
    await check('all four mise pages show the same actionable unavailable state', async () => {
      for (const name of ['配置文件', '任务', '诊断', '工具管理']) {
        await page.locator('.nav').getByRole('button', { name, exact: true }).click()
        await expect(missing).toBeVisible()
      }
      assert.deepEqual(await app.evaluate(() => globalThis.testCommands), [])
    })
    await check('repeated probes finish and execute only --version', async () => {
      for (let i = 0; i < 3; i++) {
        const retry = page.getByRole('button', { name: '重新探测', exact: true })
        await retry.click()
        await expect(retry).toBeEnabled()
        await expect(page.locator('.topbar [aria-busy="true"]')).toHaveCount(0)
      }
      const commands = await app.evaluate(() => globalThis.testCommands)
      assert.equal(commands.length, 3)
      assert.ok(commands.every(a => a.length === 1 && a[0] === '--version'))
    })
    await check('failure detail is readable and collapsed initially', async () => {
      await expect(page.locator('.unavailable-details')).not.toHaveAttribute('open', '')
      await page.getByText('查看探测详情', { exact: true }).click()
      await expect(page.locator('.unavailable-details pre')).toContainText('ENOENT')
    })
    await check('offline docs remain accessible', async () => {
      await page.locator('.unavailable-actions').getByRole('button', { name: '文档中心', exact: true }).click()
      await expect(page.locator('.docs-layout')).toBeVisible()
      await page.locator('.nav').getByRole('button', { name: '工具管理', exact: true }).click()
    })
    await check('onboarding opens environment settings with resolved defaults', async () => {
      await page.locator('.unavailable-actions').getByRole('button', { name: '环境变量', exact: true }).click()
      await expect(page.locator('.sp-nav-item.active')).toHaveText('环境变量')
      await expect(page.locator('.sp-env-head')).toHaveCount(5)
      await expect(page.locator('.sp-dir-val').first()).not.toHaveText('…')
      await expect(page.getByRole('button', { name: '刷新目录信息', exact: true })).toBeEnabled()
      await page.screenshot({ path: join(artifacts, 'env-optimized-dark.png') })
      // Read only: do not write the registry or invoke a native folder dialog.
    })
    await check('settings re-probe remains usable without mise', async () => {
      await page.getByRole('button', { name: 'mise 管理', exact: true }).click()
      await page.locator('.settings-page').getByRole('button', { name: '重新探测', exact: true }).click()
      await expect(page.locator('.settings-page').getByRole('button', { name: '重新探测', exact: true })).toBeEnabled()
      await expect(page.locator('.sp-path').first()).toContainText('未')
    })
    await check('theme and language work without mise', async () => {
      await page.getByRole('button', { name: '常规', exact: true }).click()
      await page.getByRole('button', { name: '浅色', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      await page.getByRole('button', { name: 'English', exact: true }).click()
      await page.getByRole('button', { name: 'Back to app', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'mise not detected', exact: true })).toBeVisible()
      await expect(page.getByText('Detection details', { exact: true })).toBeVisible()
    })
    await check('minimum window size has no horizontal page overflow', async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: join(artifacts, 'missing-light-small.png') })
    })
    await check('renderer reload retains missing state and preferences', async () => {
      await page.reload()
      await expect(page.getByRole('heading', { name: 'mise not detected', exact: true })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    })
    await check('broken executable produces a recoverable error', async () => {
      const broken = join(temp, 'broken.exe')
      writeFileSync(broken, 'not an executable')
      await app.evaluate((_, path) => { process.env.MISE_BIN = path }, broken)
      const status = await page.evaluate(() => window.mise.detect(true))
      assert.equal(status.installed, false)
      assert.ok(status.error)
    })
    await check('stalled probe times out, blocks duplicate clicks and recovers', async () => {
      await app.evaluate((_, node) => { globalThis.testNode = node; globalThis.testStall = true }, process.execPath)
      const retry = page.getByRole('button', { name: 'Re-probe', exact: true })
      await retry.click()
      await expect(page.getByRole('button', { name: 'Detecting…', exact: true })).toBeDisabled()
      await expect(page.locator('.topbar [aria-busy="true"]')).toBeDisabled()
      await expect(retry).toBeEnabled({ timeout: 15000 })
      await expect(page.getByRole('heading', { name: 'mise not detected', exact: true })).toBeVisible()
      await app.evaluate(() => { globalThis.testStall = false })
    })
    await check('forced probe rediscovers changed binary and clears stale success', async () => {
      // Node is only a harmless --version stand-in, never an installed mise.
      await app.evaluate((_, path) => { process.env.MISE_BIN = path }, process.execPath)
      assert.equal((await page.evaluate(() => window.mise.detect(true))).installed, true)
      await app.evaluate((_, path) => { process.env.MISE_BIN = path }, absent)
      assert.equal((await page.evaluate(() => window.mise.detect(true))).installed, false)
      assert.equal((await page.evaluate(() => window.mise.detect())).installed, false)
    })
    await check('UI recovers from missing to available and back without stale controls', async () => {
      await app.evaluate((_, node) => {
        process.env.MISE_BIN = node
        globalThis.testNode = node
        globalThis.testHealthy = true
      }, process.execPath)
      await page.getByRole('button', { name: 'Re-probe', exact: true }).click()
      await expect(page.getByRole('button', { name: '+ Add tool', exact: true })).toBeVisible()
      await expect(page.locator('.topbar [aria-busy="true"]')).toHaveCount(0)
      await page.locator('.topbar').getByRole('button', { name: 'Refresh', exact: true }).hover()
      const commandTip = page.locator('.cmd-tip.cmd')
      await expect(commandTip.locator('code')).toHaveText('mise ls --json && mise ls --json --all-sources')
      const tipBox = await commandTip.boundingBox()
      assert.ok(tipBox.width <= 560 && tipBox.x >= 7)
      assert.ok(tipBox.x + tipBox.width <= await page.evaluate(() => innerWidth - 7))
      await page.mouse.move(450, 350)
      await expect(commandTip).toHaveCount(0)
      await app.evaluate((_, path) => { process.env.MISE_BIN = path; globalThis.testHealthy = false }, absent)
      await page.locator('.topbar').getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'mise not detected', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '+ Add tool', exact: true })).toHaveCount(0)
    })
    await check('installer is available but never starts automatically', async () => {
      const plan = await page.evaluate(() => window.mise.getInstaller())
      assert.equal(plan.supported, true)
      assert.ok(plan.command.includes('https://mise.run'))
      await expect(page.getByRole('button', { name: 'Install mise', exact: true })).toBeEnabled()
      assert.equal(await app.evaluate(() => globalThis.testInstallerLaunches), 0)
    })
    await check('installer streams progress, disables duplicates and supports retry on failure', async () => {
      await app.evaluate(() => { globalThis.testInstallMode = 'fail' })
      await page.locator('.console').getByRole('button', { name: 'Collapse', exact: true }).click()
      await page.getByRole('button', { name: 'Install mise', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Installing mise…', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Re-probe', exact: true })).toBeDisabled()
      await expect(page.locator('.install-progress')).toBeVisible()
      await expect(page.locator('.console-body')).toContainText('TEST_INSTALL_PROGRESS')
      await page.screenshot({ path: join(artifacts, 'mise-install-progress.png') })
      await expect(page.locator('.install-error')).toContainText('TEST_DOWNLOAD_FAILED')
      await expect(page.getByRole('button', { name: 'Retry installation', exact: true })).toBeEnabled()
      assert.equal(await app.evaluate(() => globalThis.testInstallerLaunches), 1)
    })
    await check('installer exit zero still requires a working binary', async () => {
      await app.evaluate(() => { globalThis.testInstallMode = 'noop' })
      await page.getByRole('button', { name: 'Retry installation', exact: true }).click()
      await expect(page.locator('.install-error')).toContainText('mise was not detected')
      await expect(page.getByRole('button', { name: 'Retry installation', exact: true })).toBeEnabled()
    })
    await check('successful installer automatically detects and loads tools without restarting', async () => {
      await app.evaluate(() => { globalThis.testInstallMode = 'success' })
      await page.getByRole('button', { name: 'Retry installation', exact: true }).click()
      await expect(page.getByRole('button', { name: '+ Add tool', exact: true })).toBeVisible()
      await expect(page.locator('.toast')).toContainText('mise installed')
      await app.evaluate((_, path) => { process.env.MISE_BIN = path; globalThis.testHealthy = false }, absent)
      await page.locator('.topbar').getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'mise not detected', exact: true })).toBeVisible()
    })
    await check('main process refuses concurrent installation requests', async () => {
      await app.evaluate(() => { globalThis.testInstallMode = 'fail' })
      const before = await app.evaluate(() => globalThis.testInstallerLaunches)
      const results = await page.evaluate(() => Promise.all([
        window.mise.installMise(() => {}), window.mise.installMise(() => {}),
      ]))
      assert.ok(results.some(r => r.stderr === 'Installation already running'))
      assert.equal(await app.evaluate(() => globalThis.testInstallerLaunches), before + 1)
    })
    await check('installer start failures resolve and emit exactly one exit event', async () => {
      for (const mode of ['spawn-error', 'enoent', 'timeout']) {
        await app.evaluate((_, mode) => { globalThis.testInstallMode = mode }, mode)
        const { result, events } = await page.evaluate(async () => {
          const events = []
          const result = await window.mise.installMise(event => events.push(event))
          return { result, events }
        })
        assert.equal(result.ok, false)
        assert.equal(events.filter(e => e.type === 'exit').length, 1, JSON.stringify({ mode, result, events }))
        if (mode === 'timeout') {
          assert.ok(result.stderr.includes('mise: installing mise...'))
          assert.ok(result.stderr.includes('terminated'))
        }
      }
      await app.evaluate(() => { globalThis.testInstallMode = null })
    })
    await check('installed mise directory report calibrates estimates and source labels', async () => {
      await app.evaluate((_, { node, shims }) => {
        process.env.MISE_BIN = node
        globalThis.testHealthy = true
        globalThis.testDoctorDirs = { shims }
      }, { node: process.execPath, shims: join(temp, 'global-shims') })
      await page.evaluate(() => window.mise.detect(true))
      const dirs = await page.evaluate(() => window.mise.getEnvDirs())
      assert.equal(dirs.MISE_SHIMS_DIR.current, join(temp, 'global-shims'))
      assert.equal(dirs.MISE_SHIMS_DIR.verified, true)
      assert.equal(dirs.MISE_SHIMS_DIR.source, 'detected')
      await app.evaluate((_, path) => {
        process.env.MISE_BIN = path
        globalThis.testHealthy = false
        globalThis.testDoctorDirs = null
      }, absent)
      await page.evaluate(() => window.mise.detect(true))
    })
    await check('directory writes invalidate managed config cache without touching the registry', async () => {
      await app.evaluate(() => {
        const cp = process.getBuiltinModule('child_process')
        const fs = process.getBuiltinModule('fs')
        globalThis.testOldExec = cp.execFile
        globalThis.testUserEnv = {}
        globalThis.testEnvWrites = 0
        globalThis.testOldDirs = Object.fromEntries(['MISE_DATA_DIR', 'MISE_CONFIG_DIR', 'MISE_SHIMS_DIR', 'MISE_CACHE_DIR', 'MISE_STATE_DIR'].map(v => [v, process.env[v]]))
        // This fixture exercises an unset launch environment, independently
        // of any mise paths the user configured before running the tests.
        for (const name of Object.keys(globalThis.testOldDirs)) delete process.env[name]
        cp.execFile = (command, args, ...rest) => {
          const callback = rest[rest.length - 1]
          if (command === 'reg' && args[0] === 'export') {
            if (globalThis.testFailEnvRead) {
              globalThis.testFailEnvRead = false
              callback(new Error('TEST_REFRESH_FAILED'), '', 'TEST_REFRESH_FAILED')
              return
            }
            const text = ['Windows Registry Editor Version 5.00', '[HKEY_CURRENT_USER\\Environment]',
              ...Object.entries(globalThis.testUserEnv).map(([k, v]) => JSON.stringify(k) + '=' + JSON.stringify(v))].join('\r\n')
            fs.writeFileSync(args[2], '\uFEFF' + text, 'utf16le')
            callback(null, '', '')
            return
          }
          if (command === 'setx') {
            globalThis.testEnvWrites++
            globalThis.testUserEnv[args[0]] = args[1]
            callback(null, 'TEST_SAVED', '')
            return
          }
          if (command === 'reg' && args[0] === 'delete') {
            globalThis.testEnvWrites++
            delete globalThis.testUserEnv[args[3]]
            callback(null, '', '')
            return
          }
          return globalThis.testOldExec(command, args, ...rest)
        }
      })
      const relocated = join(temp, 'new-config')
      await page.evaluate(() => window.mise.getPins(true))
      assert.equal((await page.evaluate(path => window.mise.setEnvDir('MISE_CONFIG_DIR', path), relocated)).ok, true)
      const pins = await page.evaluate(() => window.mise.getPins())
      assert.ok(pins.some(p => p.path === join(relocated, 'config.toml')), 'cached global file must follow the new directory')
      await page.evaluate(() => window.mise.clearEnvDir('MISE_CONFIG_DIR'))
    })
    await check('environment preview, cancel, save, sources, reset, copy and help work in a small window', async () => {
      await app.evaluate(({ ipcMain }, path) => {
        ipcMain.removeHandler('mise:choose-folder')
        ipcMain.handle('mise:choose-folder', () => path)
      }, join(temp, 'new-data'))
      await page.locator('.unavailable-actions').getByRole('button', { name: 'Environment variables', exact: true }).click()
      const card = page.locator('[data-env="MISE_DATA_DIR"]')
      const refresh = page.getByRole('button', { name: 'Refresh directory information', exact: true })
      await expect(refresh).toBeEnabled()
      await expect(card.locator('.env-source')).toHaveText('Default location')
      await expect(card).toContainText('Expected path')
      await expect(page.locator('.sp-fab')).toHaveCount(0)
      const before = await app.evaluate(() => globalThis.testEnvWrites)
      await card.getByRole('button', { name: 'Change directory…', exact: true }).click()
      await expect(card.locator('.env-draft')).toContainText('Installed versions are not moved')
      assert.equal(await app.evaluate(() => globalThis.testEnvWrites), before)
      await card.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(card.locator('.env-draft')).toHaveCount(0)
      await card.getByRole('button', { name: 'Change directory…', exact: true }).click()
      await card.getByRole('button', { name: 'Apply change', exact: true }).click()
      await expect(card.locator('.env-feedback.ok')).toBeVisible()
      await expect(card.locator('.env-source')).toHaveText('User environment')
      await expect(card.locator('.sp-dir-val')).toHaveText(join(temp, 'new-data'))
      await expect(page.locator('[data-env="MISE_SHIMS_DIR"] .sp-dir-val')).toHaveText(join(temp, 'new-data', 'shims'))
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
        configurable: true, value: { writeText: async text => { globalThis.testClipboard = text } },
      }))
      await card.getByRole('button', { name: 'Copy full path', exact: true }).click()
      assert.equal(await page.evaluate(() => globalThis.testClipboard), join(temp, 'new-data'))
      await page.evaluate(() => { delete navigator.clipboard })
      await card.getByRole('button', { name: 'Remove user override', exact: true }).click()
      await expect(card.locator('.env-draft')).toContainText('Remove the user override')
      await card.getByRole('button', { name: 'Apply change', exact: true }).click()
      await expect(card.locator('.env-source')).toHaveText('Default location')
      await expect(card.locator('.env-feedback.ok')).toContainText('User override removed')
      await page.getByRole('button', { name: 'Show what the directory variables do', exact: true }).click()
      await expect(page.locator('.env-help')).toContainText('global shims_dir')
      await page.keyboard.press('Escape')
      await expect(page.locator('.env-help')).toHaveCount(0)
      await expect(page.locator('.settings-page')).toBeVisible()
      assert.ok(await page.locator('.settings-pane').evaluate(el => el.scrollWidth <= el.clientWidth))
      await page.screenshot({ path: join(artifacts, 'env-optimized-small.png') })
      await page.getByRole('button', { name: 'Back to app', exact: true }).click()
    })
    await check('environment read failure can be retried without leaving settings', async () => {
      await page.locator('.unavailable-actions').getByRole('button', { name: 'Environment variables', exact: true }).click()
      const refresh = page.getByRole('button', { name: 'Refresh directory information', exact: true })
      await expect(refresh).toBeEnabled()
      await app.evaluate(() => { globalThis.testFailEnvRead = true })
      await refresh.click()
      await expect(page.locator('.settings-page .config-error')).toContainText('TEST_REFRESH_FAILED')
      await page.getByRole('button', { name: 'Retry reading', exact: true }).click()
      await expect(page.locator('.settings-page .config-error')).toHaveCount(0)
      await expect(refresh).toBeEnabled()
      await page.getByRole('button', { name: 'Back to app', exact: true }).click()
      await app.evaluate(() => {
        process.getBuiltinModule('child_process').execFile = globalThis.testOldExec
        for (const [v, value] of Object.entries(globalThis.testOldDirs)) {
          if (value === undefined) delete process.env[v]
          else process.env[v] = value
        }
      })
      await page.evaluate(() => window.mise.getEnvDirs())
    })
    await check('environment write rejection releases busy state without changing system settings', async () => {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('mise:choose-folder')
        ipcMain.handle('mise:choose-folder', () => 'Z:\\test-only-directory')
        ipcMain.removeHandler('mise:set-env-dir')
        ipcMain.handle('mise:set-env-dir', () => { throw new Error('TEST_WRITE_REJECTED') })
      })
      await page.locator('.unavailable-actions').getByRole('button', { name: 'Environment variables', exact: true }).click()
      await page.locator('[data-env="MISE_DATA_DIR"]').getByRole('button', { name: 'Change directory…', exact: true }).click()
      await expect(page.locator('.env-draft')).toBeVisible()
      await page.getByRole('button', { name: 'Apply change', exact: true }).click()
      await expect(page.locator('.toast')).toContainText('TEST_WRITE_REJECTED')
      await expect(page.locator('.env-feedback.err')).toContainText('TEST_WRITE_REJECTED')
      await expect(page.locator('[data-env="MISE_DATA_DIR"]').getByRole('button', { name: 'Change directory…', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Back to app', exact: true }).click()
    })
    await check('environment read rejection is visible and settings can be exited', async () => {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('mise:get-env-dirs')
        ipcMain.handle('mise:get-env-dirs', () => { throw new Error('TEST_READ_REJECTED') })
      })
      await page.locator('.unavailable-actions').getByRole('button', { name: 'Environment variables', exact: true }).click()
      await expect(page.locator('.settings-page .config-error')).toContainText('TEST_READ_REJECTED')
      await page.keyboard.press('Escape')
      await expect(page.locator('.settings-page')).toHaveCount(0)
    })
    await check('no uncaught renderer errors', async () => assert.deepEqual(errors, []))
    console.log(`All ${checks} Electron checks passed. No mise was installed; no environment settings were written.`)
  } finally {
    if (app) await app.close()
    rmSync(temp, { recursive: true, force: true })
  }
}
main().catch(err => { console.error(err); process.exitCode = 1 })
