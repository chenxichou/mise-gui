// Exercise real Electron IPC and the installed mise binary. All writes (including
// actual tool downloads) stay in a temporary profile, project and mise directories.
const { _electron, expect } = require('@playwright/test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')

async function main() {
  const temp = mkdtempSync(join(tmpdir(), 'mise-gui-installed-'))
  const artifacts = resolve('test-results')
  mkdirSync(artifacts, { recursive: true })
  const project = join(temp, '项目 with spaces')
  const other = join(temp, 'second project')
  const config = join(project, 'mise.toml')
  const globalConfig = join(temp, 'config', 'config.toml')
  for (const dir of [project, other, join(temp, 'config')]) mkdirSync(dir, { recursive: true })
  writeFileSync(globalConfig, '[settings]\ndisable_update_warning = true\n')
  // Bypass any mise shims the user has since put on PATH; the task fixtures
  // should not trigger automatic installation of an unrelated Node version.
  const nodeTask = file => JSON.stringify(`"${process.execPath}" ${file}`)
  const initial = ['[env]', 'GUI_SMOKE = "initial"', '', '[tasks.gui-smoke]',
    'description = "GUI smoke task"', `run = ${nodeTask('smoke.cjs')}`, '',
    '[tasks.gui-fail]', `run = ${nodeTask('fail.cjs')}`, '',
    '[tasks.gui-slow]', `run = ${nodeTask('slow.cjs')}`, '',
    '[tasks.gui-jq]', 'run = "jq --version"', ''].join('\n')
  writeFileSync(config, initial)
  writeFileSync(join(project, 'smoke.cjs'), 'console.log("GUI_TASK_OK:" + process.env.GUI_SMOKE); console.log("GUI_CWD:" + process.cwd())')
  writeFileSync(join(project, 'fail.cjs'), 'console.error("GUI_EXPECTED_FAILURE"); process.exit(7)')
  writeFileSync(join(project, 'slow.cjs'), 'console.log("GUI_SLOW_START"); setTimeout(() => console.log("GUI_SLOW_END"), 2000)')
  writeFileSync(join(other, 'mise.toml'), `[tasks.gui-smoke]\nrun = ${nodeTask('other.cjs')}\n`)
  writeFileSync(join(other, 'other.cjs'), 'console.log("GUI_OTHER_PROJECT")')

  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(MISE_|XDG_)/i.test(key)) delete env[key]
  Object.assign(env, {
    MISE_DATA_DIR: join(temp, 'data'), MISE_CONFIG_DIR: join(temp, 'config'),
    MISE_CACHE_DIR: join(temp, 'cache'), MISE_STATE_DIR: join(temp, 'state'),
    MISE_SHIMS_DIR: join(temp, 'shims'), MISE_GLOBAL_CONFIG_FILE: globalConfig,
    MISE_CEILING_PATHS: temp,
    MISE_TASK_RUN_AUTO_INSTALL: 'false',
    APPDATA: join(temp, 'appdata'),
  })
  delete env.VITE_DEV_SERVER_URL
  delete env.ELECTRON_RUN_AS_NODE
  // Prevent saved user overrides from escaping isolation. The actual mise
  // process and every GUI IPC command are used without mocking their results.
  const bootstrap = join(temp, 'bootstrap.cjs')
  writeFileSync(bootstrap, `
    const cp = require('node:child_process'); const fs = require('node:fs');
    const { ipcMain } = require('electron'); const handle = ipcMain.handle.bind(ipcMain);
    globalThis.testInstallPayloads = [];
    globalThis.testRealListRemote = null;
    globalThis.testRealInstall = null;
    ipcMain.handle = (channel, fn) => handle(channel, (event, ...args) => {
      if (channel === 'mise:install') globalThis.testInstallPayloads.push(args[0]);
      return fn(event, ...args);
    });
    const register = ipcMain.handle;
    ipcMain.handle = (channel, fn) => {
      if (channel === 'mise:list-remote' && !globalThis.testRealListRemote) globalThis.testRealListRemote = fn;
      if (channel === 'mise:install' && !globalThis.testRealInstall) globalThis.testRealInstall = fn;
      return register(channel, fn);
    };
    const execFile = cp.execFile; const spawn = cp.spawn;
    globalThis.testRealCommands = []; globalThis.testChildren = new Set();
    cp.execFile = (file, args, options, cb) => {
      if (/^(reg|reg.exe)$/i.test(file) && args[0] === 'export') {
        fs.writeFileSync(args[2], '\\ufeffWindows Registry Editor Version 5.00\\r\\n\\r\\n[HKEY_CURRENT_USER\\\\Environment]\\r\\n', 'utf16le');
        queueMicrotask(() => cb(null, '', '')); return;
      }
      if (/^(setx|reg)(.exe)?$/i.test(file)) throw Error('Real user environment writes are blocked');
      return execFile(file, args, options, cb);
    };
    cp.spawn = (file, args, options) => {
      if (/^(powershell.exe|sh)$/i.test(file)) throw Error('Installing mise is blocked');
      if (options?.env?.MISE_DATA_DIR !== ${JSON.stringify(env.MISE_DATA_DIR)}) throw Error('Command escaped the temporary mise directories');
      globalThis.testRealCommands.push({ file, args, cwd: options?.cwd });
      const child = spawn(file, args, options); globalThis.testChildren.add(child);
      child.on('close', () => globalThis.testChildren.delete(child)); return child;
    };
    require(${JSON.stringify(resolve('dist-electron/main.cjs'))});
  `)

  let app, page
  const errors = [], checks = []
  const report = { binary: null, checks, errors, isolated: true }
  const check = async (name, fn) => {
    const started = Date.now()
    await fn()
    checks.push({ name, ms: Date.now() - started })
    console.log(`✓ ${name}`)
  }
  try {
    app = await _electron.launch({ args: [bootstrap, `--user-data-dir=${join(temp, 'chromium')}`], env, cwd: temp })
    page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    await page.evaluate(() => localStorage.setItem('mise-gui.lang', 'zh'))
    await page.reload()
    const nav = name => page.locator('.nav').getByRole('button', { name, exact: true }).click()
    const selectPin = async path => {
      const rows = page.locator('.config-file-row')
      const row = rows.filter({ has: page.getByText(path, { exact: true }) })
      await row.locator('.config-file-item').click()
    }
    const importPin = async path => {
      await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
      await page.locator('.config-files .cfg-add').click()
      await expect(page.locator('.config-meta')).toContainText(path)
    }
    const card = version => page.locator(`[data-vkey="jq@${version}"]`)
    const pinCard = path => page.locator('[data-pin]').filter({ has: page.getByText(dirname(path), { exact: true }) })
    const beginCable = async handle => {
      const view = await page.locator('.tool-canvas').boundingBox()
      await page.mouse.move(view.x + 2, view.y + 2)
      await expect(page.locator('.cmd-tip')).toHaveCount(0)
      await page.getByRole('button', { name: '适应画布', exact: true }).click()
      await handle.scrollIntoViewIfNeeded()
      const r = await handle.boundingBox()
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
      await page.mouse.down()
      await page.mouse.move(r.x + r.width / 2 - 15, r.y + r.height / 2 + 15, { steps: 3 })
      await expect(page.locator('[data-cable-preview]')).toHaveCount(1)
    }
    const aimCable = async target => {
      for (let i = 0; i < 4; i++) {
        const r = await target.boundingBox()
        await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
        if ((await target.getAttribute('class')).includes('cable-over')) break
      }
      await expect(target).toHaveClass(/cable-over/)
    }
    const connectionLine = (version, path) => page.getByRole('button', { name: `选择连线 jq@${version} → ${path}`, exact: true })
    const selectConnection = async (version, path) => {
      const line = connectionLine(version, path)
      await line.focus(); await page.keyboard.press('Enter')
      await expect(line).toHaveAttribute('aria-pressed', 'true')
    }
    const confirmChange = async () => {
      const dialog = page.getByRole('dialog')
      await dialog.locator('.modal-foot .primary').click()
      await expect(dialog).toHaveCount(0, { timeout: 180000 })
    }
    const assertGraph = async () => {
      const tools = await page.evaluate(() => window.mise.listInstalled())
      const expectedIdle = tools.filter(tool => tool.versions.some(v => v.installed && !v.sources.length)).length
      const expectedVersions = tools.flatMap(tool => tool.versions.flatMap(v =>
        [...new Set(v.sources.map(s => s.path.toLowerCase().replaceAll('/', '\\')))].map(target => ({
          key: `${tool.name}@${v.version}`, target, state: v.installed ? 'on' : 'todo',
        }))))
      await expect(page.locator('.tool-links path.lk-idle')).toHaveCount(expectedIdle)
      await expect(page.locator('.tool-links path[data-source="version"]')).toHaveCount(expectedVersions.length)
      const measure = () => page.locator('.tool-links path').evaluateAll(paths => {
        const key = p => p.toLowerCase().replaceAll('/', '\\')
        return paths.map(path => {
          const source = path.dataset.source === 'version'
            ? [...document.querySelectorAll('[data-vkey]')].find(el => el.dataset.vkey === path.dataset.sourceKey)
            : [...document.querySelectorAll('[data-tool]')].find(el => el.dataset.tool === path.dataset.sourceKey)
          const target = path.dataset.targetKey === 'idle' ? document.querySelector('[data-bucket]')
            : [...document.querySelectorAll('[data-pin]')].find(el => key(el.dataset.pin) === path.dataset.targetKey)
          const r = source.getBoundingClientRect(), t = target.getBoundingClientRect()
          const matrix = path.getScreenCTM()
          const start = path.getPointAtLength(0).matrixTransform(matrix), end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix)
          const x = path.dataset.source === 'version' ? r.left : r.left + r.width / 2
          const y = path.dataset.source === 'version' ? r.top + r.height / 2 : r.bottom
          return {
            source: path.dataset.source, key: path.dataset.sourceKey, target: path.dataset.targetKey,
            state: path.classList.contains('lk-on') ? 'on' : path.classList.contains('lk-todo') ? 'todo' : 'idle',
            dx: Math.abs(start.x - x), dy: Math.abs(start.y - y),
            endDx: Math.abs(end.x - (path.classList.contains('lk-on') ? t.left : t.right)),
            endDy: Math.max(t.top - end.y, end.y - t.bottom, 0),
          }
        })
      })
      // ResizeObserver updates the SVG after layout. Wait for the actual
      // endpoints to settle rather than assuming innerWidth implies a frame.
      await expect.poll(async () => (await measure()).every(edge => edge.dx < 1 && edge.dy < 1 && edge.endDx < 1 && edge.endDy < 1)).toBe(true)
      const measured = await measure()
      for (const edge of measured) {
        assert.ok(edge.dx < 1 && edge.dy < 1 && edge.endDx < 1 && edge.endDy < 1, JSON.stringify(edge))
        if (edge.source === 'tool') assert.equal(edge.target, 'idle')
      }
      for (const edge of expectedVersions) assert.ok(measured.some(actual =>
        actual.source === 'version' && actual.key === edge.key && actual.target === edge.target && actual.state === edge.state), JSON.stringify(edge))
      await expect(page.locator('.tool-card [role="switch"]')).toHaveCount(0)
      await expect(page.locator('.tool-card .tool-source, .tool-card .tool-source-row')).toHaveCount(0)
      assert.ok((await page.locator('.tool-card').allTextContents()).every(text => !text.includes('来源：')))
    }
    const install = async (version, pin) => {
      await page.getByRole('button', { name: '+ 添加工具', exact: true }).click()
      const modal = page.locator('.modal')
      await modal.getByPlaceholder('例如 node、python、terraform…').fill('jq')
      await modal.locator('.result-row').filter({ has: page.getByText('jq', { exact: true }) }).click()
      await modal.locator('.result-row').filter({ has: page.getByText(version, { exact: true }) }).click({ timeout: 90000 })
      await modal.getByRole('checkbox').setChecked(pin)
      await modal.getByRole('button', { name: pin ? '安装并设为当前' : '仅安装', exact: true }).click()
      await expect(page.locator('.overlay')).toHaveCount(0, { timeout: 180000 })
      await expect(card(version)).toBeVisible()
      await expect(card(version).locator('.badge')).not.toHaveText('待安装')
      if (pin) await expect(card(version).locator('.badge')).toHaveText(/^(已启用|当前)$/)
    }
    const openConnection = async path => {
      await page.getByRole('button', { name: '适应画布', exact: true }).click()
      await pinCard(path).locator('.pin-card-hit').click()
      await page.locator('[data-cable-tool="jq"]').focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog')
      await expect(dialog.locator('#connection-config')).toHaveValue(path)
      return dialog
    }
    const connectVersion = async (path, version) => {
      const dialog = await openConnection(path)
      await dialog.locator(`[data-version="${version}"]`).click({ timeout: 90000 })
      await expect(dialog.locator('.connection-path')).toHaveText(path)
      await dialog.locator('.modal-foot .primary').click()
      await expect(dialog).toHaveCount(0, { timeout: 180000 })
      await expect(card(version).locator('.badge')).toHaveText(/^(已启用|当前)$/)
    }

    await check('real installed mise is detected by the desktop without a binary override', async () => {
      report.binary = await page.evaluate(() => window.mise.detect(true))
      assert.equal(report.binary.installed, true, JSON.stringify(report.binary))
      assert.ok(existsSync(report.binary.path))
      await expect(page.getByRole('button', { name: '+ 添加工具', exact: true })).toBeEnabled()
      await expect(page.getByRole('heading', { name: '未检测到 mise', exact: true })).toHaveCount(0)
      await expect(page.locator('.tool-card')).toHaveCount(0)
      await expect(page.locator('.topbar .filter-seg')).toHaveCount(0)
    })
    await check('real doctor and environment paths resolve inside the temporary profile', async () => {
      const doctor = await page.evaluate(() => window.mise.getDoctor())
      report.doctor = doctor
      assert.ok(doctor.version, JSON.stringify(doctor))
      for (const key of ['data', 'cache', 'state', 'shims']) assert.ok(doctor.dirs[key].startsWith(temp), key)
      await nav('诊断')
      await expect(page.locator('.doctor-version')).toContainText(report.binary.version)
      await expect(page.locator('.doctor-scroll')).toContainText(env.MISE_DATA_DIR)
      await page.screenshot({ path: join(artifacts, 'installed-doctor.png') })
    })
    await check('import, edit, validation, save and trust use a real project with a Unicode/spaced path', async () => {
      await nav('配置文件')
      await importPin(config)
      const editor = page.locator('.config-textarea')
      await expect(editor).toHaveValue(initial)
      await editor.fill('[tools\ninvalid')
      await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
      assert.equal(readFileSync(config, 'utf8'), initial)
      await editor.fill(initial.replace('"initial"', '"saved"'))
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.locator('.toast')).toHaveText('配置已保存')
      assert.ok(readFileSync(config, 'utf8').includes('"saved"'))
      await page.getByRole('button', { name: '信任配置', exact: true }).click()
      await expect(page.getByRole('button', { name: '已信任', exact: true })).toBeVisible()
    })
    await check('real successful and failed tasks stream output and leave controls usable', async () => {
      report.projectBeforeTasks = await page.evaluate(path => window.mise.listInstalled(path), config)
      await nav('任务')
      const task = name => page.locator('.task-row').filter({ has: page.getByText(name, { exact: true }) })
      await task('gui-smoke').getByRole('button', { name: '运行', exact: true }).click()
      await expect(page.locator('.console-body')).toContainText('GUI_TASK_OK:saved')
      await expect(page.locator('.console-body')).toContainText(project)
      await expect(page.locator('.toast')).toHaveText('任务 gui-smoke 执行成功')
      await task('gui-fail').getByRole('button', { name: '运行', exact: true }).click()
      await expect(page.locator('.console-body')).toContainText('GUI_EXPECTED_FAILURE')
      await expect(page.locator('.console-line.exit-err')).toContainText('run gui-fail 退出码 7')
      await expect(task('gui-smoke').getByRole('button')).toBeEnabled()
      await task('gui-slow').getByRole('button', { name: '运行', exact: true }).click()
      await expect(page.locator('.console-body')).toContainText('GUI_SLOW_START')
      await expect(task('gui-smoke').getByRole('button')).toBeDisabled()
      await page.locator('.console').getByRole('button', { name: '收起', exact: true }).click()
      await expect(page.getByRole('button', { name: /命令输出.*运行中/ })).toBeVisible()
      await expect(task('gui-smoke').getByRole('button')).toBeEnabled()
      await page.locator('button.console-head').click()
      await expect(page.locator('.console-body')).toContainText('GUI_SLOW_END')
    })
    await check('switching managed projects changes the actual task execution directory', async () => {
      await nav('配置文件')
      await importPin(join(other, 'mise.toml'))
      await page.getByRole('button', { name: '信任配置', exact: true }).click()
      await expect(page.getByRole('button', { name: '已信任', exact: true })).toBeVisible()
      await nav('任务')
      await page.locator('.task-row').filter({ hasText: 'gui-smoke' }).getByRole('button', { name: '运行', exact: true }).click()
      await expect(page.locator('.console-body')).toContainText('GUI_OTHER_PROJECT')
      await nav('配置文件')
      await selectPin(project)
      await expect(page.locator('.config-textarea')).toContainText('GUI_SMOKE')
    })
    await check('global settings save and reset through real mise commands', async () => {
      await selectPin(join(temp, 'config'))
      const jobs = page.locator('.settings-row').filter({ has: page.getByText('jobs', { exact: true }) })
      const before = (await page.evaluate(() => window.mise.getSettings())).all.jobs
      const value = before === 2 ? 3 : 2
      await jobs.locator('input').fill(String(value))
      await jobs.locator('input').press('Enter')
      await expect(jobs.getByRole('button', { name: '恢复默认', exact: true })).toBeVisible()
      assert.match(readFileSync(globalConfig, 'utf8'), new RegExp('jobs\\s*=\\s*' + value))
      await jobs.getByRole('button', { name: '恢复默认', exact: true }).click()
      await expect(jobs.getByRole('button', { name: '恢复默认', exact: true })).toHaveCount(0)
      assert.equal((await page.evaluate(() => window.mise.getSettings())).all.jobs, before)
    })
    await check('registry search, version list and actual install-only download work', async () => {
      await selectPin(project)
      await nav('工具管理')
      await install('1.7.1', false)
      await assertGraph()
      assert.doesNotMatch(readFileSync(config, 'utf8'), /^jq\s*=/m)
      await page.screenshot({ path: join(artifacts, 'installed-tool-idle.png') })
    })
    await check('connector handles connect and switch versions only in the explicit config', async () => {
      report.pinsBeforeUse = await page.evaluate(() => window.mise.getPins())
      await connectVersion(config, '1.7.1')
      assert.match(readFileSync(config, 'utf8'), /jq\s*=\s*"1\.7\.1"/)
      await connectVersion(config, '1.8.1')
      await assertGraph()
      assert.match(readFileSync(config, 'utf8'), /jq\s*=\s*"1\.8\.1"/)
      const tools = await page.evaluate(() => window.mise.listInstalled())
      const jq = tools.find(tool => tool.name === 'jq')
      assert.equal(jq.versions.length, 2)
      assert.ok(jq.versions.find(version => version.version === '1.8.1').sources.some(source => source.path === config))
      assert.ok(!readFileSync(globalConfig, 'utf8').includes('jq'))
      assert.ok(!readFileSync(join(other, 'mise.toml'), 'utf8').includes('jq'))
      await nav('配置文件')
      await expect(page.locator('.config-meta')).toContainText(config)
      await page.screenshot({ path: join(artifacts, 'installed-config.png') })
      await nav('任务')
      await page.locator('.task-row').filter({ has: page.getByText('gui-jq', { exact: true }) }).getByRole('button', { name: '运行', exact: true }).click()
      await expect(page.locator('.console-body')).toContainText('jq-1.8.1')
      await expect(page.locator('.toast')).toHaveText('任务 gui-jq 执行成功')
    })
    await check('removing the config request keeps downloads and merges idle versions into one tool connection', async () => {
      await nav('配置文件')
      await selectPin(project)
      const editor = page.locator('.config-textarea')
      await expect(editor).toHaveValue(readFileSync(config, 'utf8'))
      await editor.fill(readFileSync(config, 'utf8').replace(/^jq\s*=.*(?:\r?\n|$)/m, ''))
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.locator('.toast')).toHaveText('配置已保存')
      await nav('工具管理')
      const tools = await page.evaluate(() => window.mise.listInstalled())
      const installed = tools.find(tool => tool.name === 'jq').versions.find(v => v.version === '1.8.1').installPath
      assert.ok(installed && existsSync(installed))
      await assertGraph()
      await expect(page.locator('.tool-links path.lk-idle')).toHaveCount(1)
      assert.ok(existsSync(installed))
      assert.doesNotMatch(readFileSync(config, 'utf8'), /^jq\s*=/m)
      await card('1.8.1').getByRole('button', { name: '卸载', exact: true }).click()
      await page.locator('.modal').getByRole('button', { name: '取消', exact: true }).click()
      assert.ok(existsSync(installed))
      await card('1.8.1').getByRole('button', { name: '卸载', exact: true }).click()
      await page.locator('.modal').getByRole('button', { name: '卸载', exact: true }).click()
      await expect(card('1.8.1')).toHaveCount(0)
      assert.ok(!existsSync(installed))
    })
    await check('uninstalling a requested version produces a missing row and supports reinstall', async () => {
      await connectVersion(config, '1.7.1')
      await card('1.7.1').getByRole('button', { name: '卸载', exact: true }).click()
      await expect(page.locator('.confirm-warn')).toContainText(config)
      await page.locator('.modal').getByRole('button', { name: '卸载', exact: true }).click()
      await expect(card('1.7.1').locator('.badge')).toHaveText('待安装')
      await assertGraph()
      await expect(card('1.7.1')).toBeVisible()
      await expect(page.locator('.topbar .filter-seg')).toHaveCount(0)
      await card('1.7.1').getByRole('button', { name: '安装', exact: true }).click()
      await expect(card('1.7.1').locator('.badge')).not.toHaveText('待安装', { timeout: 180000 })
      await page.screenshot({ path: join(artifacts, 'installed-tools.png') })
    })
    await check('existing local installations can be linked through the GUI', async () => {
      const tools = await page.evaluate(() => window.mise.listInstalled())
      const installed = tools.find(tool => tool.name === 'jq').versions.find(v => v.version === '1.7.1').installPath
      const external = join(temp, 'external jq')
      cpSync(installed, external, { recursive: true })
      await page.getByRole('button', { name: '+ 添加工具', exact: true }).click()
      await page.getByRole('button', { name: '导入本机已有安装', exact: true }).click()
      const inputs = page.locator('.modal .input')
      await inputs.nth(0).fill('jq')
      await inputs.nth(1).fill('99.0.1')
      await inputs.nth(2).fill(external)
      await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click()
      await expect(card('99.0.1')).toBeVisible()
      await assertGraph()
      assert.ok(!readFileSync(config, 'utf8').includes('99.0.1'))
    })
    await check('connecting another config previews the exact command and cancellation does not write', async () => {
      const secondConfig = join(other, 'mise.toml')
      const firstBefore = readFileSync(config, 'utf8')
      const secondBefore = readFileSync(secondConfig, 'utf8')
      let dialog = await openConnection(secondConfig)
      await dialog.locator('[data-version="1.7.1"]').click()
      await dialog.locator('#connection-config').selectOption(globalConfig)
      await expect(dialog.locator('.connection-preview')).toContainText('未连接')
      await expect(dialog.locator('.modal-foot .primary')).toBeDisabled()
      await dialog.locator('#connection-config').selectOption(secondConfig)
      await dialog.locator('[data-version="1.7.1"]').click()
      const submit = dialog.locator('.modal-foot .primary')
      await submit.hover()
      await expect(page.locator('.cmd-tip code')).toHaveText(`mise use jq@1.7.1 --path "${secondConfig}"`)
      await page.screenshot({ path: join(artifacts, 'connect-tool-dialog.png') })
      await dialog.locator('.modal-foot').getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(readFileSync(config, 'utf8'), firstBefore)
      assert.equal(readFileSync(secondConfig, 'utf8'), secondBefore)
      await connectVersion(secondConfig, '1.7.1')
      assert.equal(readFileSync(config, 'utf8'), firstBefore)
      assert.match(readFileSync(secondConfig, 'utf8'), /^jq\s*=\s*"1\.7\.1"/m)
      await assertGraph()
    })
    await check('installed versions remain selectable offline and a failed connection preserves the dialog for retry', async () => {
      const before = readFileSync(globalConfig, 'utf8')
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('mise:list-remote')
        ipcMain.handle('mise:list-remote', () => { throw Error('TEST_REMOTE_OFFLINE') })
        ipcMain.removeHandler('mise:install')
        ipcMain.handle('mise:install', async (event, payload) => {
          await new Promise(resolve => setTimeout(resolve, 1000))
          event.sender.send(`mise:event:${payload.reqId}`, { type: 'stderr', data: 'TEST_CONNECT_FAILED' })
          event.sender.send(`mise:event:${payload.reqId}`, { type: 'exit', data: '', code: 23 })
          return { ok: false, code: 23, stdout: '', stderr: 'TEST_CONNECT_FAILED' }
        })
      })
      const dialog = await openConnection(globalConfig)
      await expect(dialog.locator('.connection-load-error')).toContainText('仍可选择已安装版本')
      await dialog.locator('[data-version="1.7.1"]').click()
      const count = await app.evaluate(() => globalThis.testInstallPayloads.length)
      await dialog.locator('.modal-foot .primary').evaluate(button => { button.click(); button.click() })
      await expect(dialog.locator('.modal-foot .primary')).toBeDisabled()
      await expect(dialog.getByRole('alert')).toContainText('TEST_CONNECT_FAILED')
      await expect(dialog.locator('.modal-foot .primary')).toBeEnabled()
      await expect(dialog.locator('#connection-config')).toBeEnabled()
      assert.equal(await app.evaluate(() => globalThis.testInstallPayloads.length), count + 1)
      assert.equal(readFileSync(globalConfig, 'utf8'), before)
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('mise:list-remote'); ipcMain.handle('mise:list-remote', globalThis.testRealListRemote)
        ipcMain.removeHandler('mise:install'); ipcMain.handle('mise:install', globalThis.testRealInstall)
      })
      await dialog.getByRole('button', { name: '重试加载', exact: true }).click()
      await expect(dialog.locator('.connection-load-error')).toHaveCount(0)
      await dialog.locator('.modal-foot').getByRole('button', { name: '取消', exact: true }).click()
    })
    await check('settings environment read/refresh, documentation and small-window layout work with mise installed', async () => {
      await page.locator('.sidebar').getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('button', { name: '环境变量', exact: true }).click()
      await expect(page.locator('.sp-env-head')).toHaveCount(5)
      const dirs = await page.evaluate(() => window.mise.getEnvDirs())
      for (const value of Object.values(dirs)) {
        assert.ok(value.current.startsWith(temp), value.current)
        assert.equal(value.verified, true)
      }
      await page.getByRole('button', { name: '刷新目录信息', exact: true }).click()
      await expect(page.getByRole('button', { name: '刷新目录信息', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: '返回应用', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name: '文档中心', exact: true }).click()
      await expect(page.locator('.docs-layout')).toBeVisible()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
      await nav('工具管理')
      await assertGraph()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: join(artifacts, 'installed-small.png') })
    })
    await check('install-and-use targets the selected global file even before that file exists', async () => {
      await nav('配置文件')
      await selectPin(join(temp, 'config'))
      await nav('工具管理')
      await install('1.7.1', true)
      assert.match(readFileSync(globalConfig, 'utf8'), /^jq\s*=\s*"1\.7\.1"/m)
      assert.ok(!existsSync(join(temp, 'config', 'mise.toml')), 'must not create a different file alongside the selected global config')
      rmSync(globalConfig)
      await page.evaluate(() => window.mise.getPins(true))
      await install('1.7.1', true)
      assert.ok(existsSync(globalConfig), 'a missing global config must be created at the selected path')
      assert.match(readFileSync(globalConfig, 'utf8'), /^jq\s*=\s*"1\.7\.1"/m)
      assert.ok(!existsSync(join(temp, 'mise.toml')), 'must not silently fall back to the working directory')
      const outside = join(temp, 'unmanaged', 'mise.toml')
      const denied = await page.evaluate(async path => {
        const events = []
        const result = await window.mise.install('jq', '1.7.1', { pin: true, configPath: path }, event => events.push(event))
        return { result, events }
      }, outside)
      assert.equal(denied.result.ok, false)
      assert.equal(denied.events.filter(event => event.type === 'exit').length, 1)
      assert.ok(!existsSync(outside))
    })
    await check('renderer reload retains imported configs and live installed tools', async () => {
      await page.reload()
      await expect(card('1.7.1')).toBeVisible()
      await expect(card('99.0.1')).toBeVisible()
      await assertGraph()
      const pins = await page.evaluate(() => window.mise.getPins(true))
      assert.ok(pins.some(pin => pin.path === config))
      assert.deepEqual(errors, [])
    })
    await check('dragging version ports previews and switches the explicit config without changing other files', async () => {
      const firstBefore = readFileSync(config, 'utf8')
      const secondBefore = readFileSync(join(other, 'mise.toml'), 'utf8')
      const globalBefore = readFileSync(globalConfig, 'utf8')
      await beginCable(card('99.0.1').locator('.version-handle'))
      await aimCable(pinCard(globalConfig))
      await page.screenshot({ path: join(artifacts, 'tool-cable-preview.png') })
      await page.mouse.up()
      const dialog = page.getByRole('dialog')
      await expect(dialog.locator('#connection-config')).toHaveValue(globalConfig)
      await expect(dialog.locator('[data-version="99.0.1"]')).toHaveAttribute('aria-pressed', 'true')
      assert.equal(readFileSync(globalConfig, 'utf8'), globalBefore, 'dropping must only preview')
      await dialog.locator('.modal-foot .primary').hover()
      await expect(page.locator('.cmd-tip code')).toHaveText(`mise use jq@99.0.1 --path "${globalConfig}"`)
      await dialog.locator('.modal-foot .primary').click()
      await expect(dialog).toHaveCount(0, { timeout: 180000 })
      await expect.poll(() => readFileSync(globalConfig, 'utf8')).toMatch(/^jq\s*=\s*"99\.0\.1"/m)
      assert.equal(readFileSync(config, 'utf8'), firstBefore)
      assert.equal(readFileSync(join(other, 'mise.toml'), 'utf8'), secondBefore)
      await assertGraph()
    })
    await check('cables cancel on blank space, Escape, pointer cancellation and blur; tool ports choose versions', async () => {
      const before = readFileSync(globalConfig, 'utf8')
      const count = await app.evaluate(() => globalThis.testInstallPayloads.length)
      const handle = card('1.7.1').locator('.version-handle')
      await beginCable(handle)
      await page.mouse.move(10, 150)
      await page.mouse.up()
      await expect(page.locator('[data-cable-preview], .overlay')).toHaveCount(0)
      await beginCable(handle)
      await aimCable(pinCard(globalConfig))
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect(page.locator('[data-cable-preview], .overlay')).toHaveCount(0)
      for (const type of ['pointercancel', 'blur']) {
        await beginCable(handle)
        await page.evaluate(type => window.dispatchEvent(type === 'blur' ? new Event(type) : new PointerEvent(type, { pointerId: 1 })), type)
        await expect(page.locator('[data-cable-preview]')).toHaveCount(0)
        await page.mouse.up()
      }
      await beginCable(page.locator('[data-cable-tool="jq"]'))
      await aimCable(pinCard(globalConfig))
      await page.mouse.up()
      let dialog = page.getByRole('dialog')
      await expect(dialog.locator('#connection-version')).toBeVisible()
      await expect(dialog.locator('.modal-foot .primary')).toBeDisabled()
      await dialog.locator('.modal-foot').getByRole('button', { name: '取消', exact: true }).click()
      await handle.focus()
      await page.keyboard.press('Enter')
      dialog = page.getByRole('dialog')
      await expect(dialog.locator('[data-version="1.7.1"]')).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('Escape')
      await expect(handle).toBeFocused()
      assert.equal(readFileSync(globalConfig, 'utf8'), before)
      assert.equal(await app.evaluate(() => globalThis.testInstallPayloads.length), count)
    })
    await check('existing source endpoints switch real versions and keep other configs untouched', async () => {
      const firstBefore = readFileSync(config, 'utf8'), secondBefore = readFileSync(join(other, 'mise.toml'), 'utf8')
      await selectConnection('99.0.1', globalConfig)
      await beginCable(page.locator('[data-edge-end="source"]'))
      await aimCable(card('1.7.1'))
      await page.mouse.up()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect.poll(() => readFileSync(globalConfig, 'utf8')).toMatch(/^jq\s*=\s*"1\.7\.1"/m)
      await expect(connectionLine('1.7.1', globalConfig)).toHaveCount(1)
      assert.equal(readFileSync(config, 'utf8'), firstBefore)
      assert.equal(readFileSync(join(other, 'mise.toml'), 'utf8'), secondBefore)
      await assertGraph()
    })
    await check('existing config endpoints move real requests and remove the original request without pruning', async () => {
      const firstBefore = readFileSync(config, 'utf8')
      await selectConnection('1.7.1', globalConfig)
      await beginCable(page.locator('[data-edge-end="target"]'))
      await aimCable(pinCard(join(other, 'mise.toml')))
      await page.mouse.up(); await confirmChange()
      assert.doesNotMatch(readFileSync(globalConfig, 'utf8'), /^jq\s*=/m)
      assert.match(readFileSync(join(other, 'mise.toml'), 'utf8'), /^jq\s*=\s*"1\.7\.1"/m)
      assert.equal(readFileSync(config, 'utf8'), firstBefore)
      const jq = (await page.evaluate(() => window.mise.listInstalled())).find(t => t.name === 'jq')
      assert.ok(existsSync(jq.versions.find(v => v.version === '1.7.1').installPath))
      await assertGraph()
    })
    await check('deleting an existing real connection only removes its selected config request', async () => {
      const secondBefore = readFileSync(join(other, 'mise.toml'), 'utf8')
      await selectConnection('1.7.1', config)
      await page.locator('.edge-actions').getByRole('button', { name: '删除连线', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('.confirm-danger').hover()
      await expect(page.locator('.cmd-tip code')).toHaveText(`mise unuse jq@1.7.1 --no-prune --path "${config}"`)
      await dialog.locator('.confirm-danger').click(); await expect(dialog).toHaveCount(0)
      assert.doesNotMatch(readFileSync(config, 'utf8'), /^jq\s*=/m)
      assert.match(readFileSync(config, 'utf8'), /GUI_SMOKE/)
      assert.equal(readFileSync(join(other, 'mise.toml'), 'utf8'), secondBefore)
      await expect(card('1.7.1')).toHaveCount(1)
      await assertGraph()
    })
    await check('alias and multiple-version requests retain unrelated versions when rewired or deleted', async () => {
      const TOML = require('smol-toml')
      const linked = await page.evaluate(async path => window.mise.link('jq', '100.0.1', path, false, () => {}), join(temp, 'external jq'))
      assert.equal(linked.ok, true)
      const parsed = TOML.parse(readFileSync(config, 'utf8'))
      parsed.tools = { jq: ['1.7', '99.0.1'] }
      writeFileSync(config, TOML.stringify(parsed))
      await page.locator('.topbar').getByRole('button', { name: '刷新', exact: true }).click()
      await expect(connectionLine('1.7.1', config)).toHaveCount(1)
      await selectConnection('1.7.1', config)
      await beginCable(page.locator('[data-edge-end="source"]'))
      await aimCable(card('100.0.1')); await page.mouse.up()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(connectionLine('100.0.1', config)).toHaveCount(1)
      const after = TOML.parse(readFileSync(config, 'utf8')).tools.jq
      assert.deepEqual([...after].sort(), ['100.0.1', '99.0.1'].sort())
      await selectConnection('100.0.1', config)
      await page.locator('.edge-actions').getByRole('button', { name: '删除连线', exact: true }).click()
      await page.getByRole('dialog').locator('.confirm-danger').click(); await expect(page.getByRole('dialog')).toHaveCount(0)
      const remaining = TOML.parse(readFileSync(config, 'utf8')).tools.jq
      assert.deepEqual(Array.isArray(remaining) ? remaining : [remaining], ['99.0.1'])
      await expect(connectionLine('99.0.1', config)).toHaveCount(1)
      await assertGraph()
    })
    await check('right-side drops disable real alias requests, survive reload and restore without losing siblings or downloads', async () => {
      const TOML = require('smol-toml')
      const before = readFileSync(config, 'utf8'), otherBefore = readFileSync(join(other, 'mise.toml'), 'utf8')
      const parsed = TOML.parse(before); parsed.tools = { jq: ['1.7', '99.0.1'] }
      writeFileSync(config, TOML.stringify(parsed))
      await page.locator('.topbar').getByRole('button', { name: '刷新', exact: true }).click()
      await expect(connectionLine('1.7.1', config)).toHaveCount(1)
      const installed = (await page.evaluate(() => window.mise.listInstalled())).find(t => t.name === 'jq').versions.find(v => v.version === '1.7.1').installPath
      await selectConnection('1.7.1', config)
      await beginCable(page.locator('[data-edge-end="target"]'))
      let r = await pinCard(config).boundingBox()
      await page.mouse.move(r.x + r.width + 8, r.y + r.height / 2)
      await expect(page.locator('.canvas-cable-status')).toContainText('松开即可停用')
      await page.mouse.up()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.tool-links path.lk-disabled')).toHaveCount(1)
      const remaining = TOML.parse(readFileSync(config, 'utf8')).tools.jq
      assert.deepEqual(Array.isArray(remaining) ? remaining : [remaining], ['99.0.1'])
      assert.ok(existsSync(installed)); assert.equal(readFileSync(join(other, 'mise.toml'), 'utf8'), otherBefore)
      await expect(page.locator('.tool-links path.lk-disabled')).toHaveAttribute('data-source', 'tool')
      await page.screenshot({ path: join(artifacts, 'disabled-config-connection.png'), fullPage: true })
      await page.reload(); await nav('工具管理')
      await expect(page.locator('.tool-links path.lk-disabled')).toHaveCount(1)
      await selectConnection('1.7.1', config); await beginCable(page.locator('[data-edge-end="target"]'))
      r = await pinCard(config).boundingBox()
      await page.mouse.move(r.x - 8, r.y + r.height / 2)
      await expect(page.locator('.canvas-cable-status')).toContainText('松开即可恢复启用')
      await page.mouse.up()
      await expect(page.locator('.tool-links path.lk-disabled')).toHaveCount(0)
      await expect(connectionLine('1.7.1', config)).toHaveCount(1)
      assert.deepEqual(TOML.parse(readFileSync(config, 'utf8')).tools.jq.sort(), ['1.7', '99.0.1'].sort())
      assert.ok(existsSync(installed)); assert.equal(readFileSync(join(other, 'mise.toml'), 'utf8'), otherBefore)
      writeFileSync(config, before)
      await page.locator('.topbar').getByRole('button', { name: '刷新', exact: true }).click()
      await assertGraph()
    })
    await check('graph layout fixtures keep exact version/tool endpoints across grid wrapping and resizing', async () => {
      const fixture = ['alpha', 'beta', 'gamma', 'delta'].map((name, index) => ({
        name,
        versions: [
          { version: '1.0.0', installed: true, active: false,
            sources: [{ path: config }, ...(index === 0 ? [{ path: globalConfig }] : [])] },
          { version: '2.0.0', installed: false, active: false, sources: [{ path: join(other, 'mise.toml') }] },
          { version: '3.0.0', installed: true, active: false, sources: [] },
          { version: '4.0.0', installed: true, active: false, sources: [] },
        ],
      }))
      // Synthetic names only exercise the graph/picker; remote choices are
      // stubbed and the confirmation is cancelled without running mise use.
      await app.evaluate(({ ipcMain }, fixture) => {
        ipcMain.removeHandler('mise:list-installed')
        ipcMain.handle('mise:list-installed', () => fixture)
        ipcMain.removeHandler('mise:list-remote')
        ipcMain.handle('mise:list-remote', () => [])
      }, fixture)
      await page.locator('.topbar').getByRole('button', { name: '刷新', exact: true }).click()
      await expect(page.locator('.tool-card')).toHaveCount(4)
      for (const width of [1440, 900, 1180]) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 820), width)
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        await assertGraph()
        await expect(page.locator('.tool-links path.lk-idle')).toHaveCount(4)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        await page.screenshot({ path: join(artifacts, `tool-graph-${width}.png`), fullPage: true })
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
      const handle = page.locator('[data-tool="alpha"] [data-cable-version="2.0.0"]')
      await beginCable(handle)
      const viewport = await page.locator('.tool-canvas').boundingBox()
      const before = await page.locator('.canvas-world').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).e)
      await page.mouse.move(viewport.x + viewport.width - 3, viewport.y + viewport.height / 2)
      await expect.poll(() => page.locator('.canvas-world').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).e)).toBeLessThan(before - 10)
      await page.keyboard.press('Escape'); await page.mouse.up()
      await beginCable(handle)
      await aimCable(pinCard(globalConfig))
      await page.mouse.up()
      const dialog = page.getByRole('dialog')
      await expect(dialog.locator('[data-version="2.0.0"]')).toHaveAttribute('aria-pressed', 'true')
      await expect(dialog.locator('.hint')).toContainText('先下载并安装')
      await dialog.locator('.modal-foot').getByRole('button', { name: '取消', exact: true }).click()
      assert.deepEqual(errors, [])
    })
    report.commands = await app.evaluate(() => globalThis.testRealCommands)
    assert.ok(report.commands.some(cmd => cmd.args[0] === 'install'))
    assert.ok(report.commands.some(cmd => cmd.args[0] === 'use'))
    console.log(`All ${checks.length} installed-mise checks passed. Real tool downloads were isolated; no user configuration was changed.`)
  } catch (error) {
    report.failure = String(error.stack || error)
    if (app) {
      report.commands = await app.evaluate(() => globalThis.testRealCommands).catch(() => [])
      report.installPayloads = await app.evaluate(() => globalThis.testInstallPayloads).catch(() => [])
    }
    if (page) {
      await page.screenshot({ path: join(artifacts, 'installed-failure.png') }).catch(() => {})
      report.console = await page.locator('.console-body').innerText().catch(() => '')
      report.body = await page.locator('body').innerText().catch(() => '')
    }
    throw error
  } finally {
    if (app) {
      await app.evaluate(() => { for (const child of globalThis.testChildren || []) child.kill() }).catch(() => {})
      await app.close().catch(() => {})
    }
    writeFileSync(join(artifacts, 'installed-mise-report.json'), JSON.stringify(report, null, 2))
    // Only our resolved temporary folder is removed, never the user's mise dirs.
    assert.ok(temp.startsWith(join(tmpdir(), 'mise-gui-installed-')))
    rmSync(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
