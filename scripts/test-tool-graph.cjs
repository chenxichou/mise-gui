// Production Electron renderer with controlled IPC data. No tool/system writes.
const { _electron, expect } = require('@playwright/test')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const temp = mkdtempSync(join(tmpdir(), 'mise-gui-graph-'))
  const artifacts = resolve('test-results')
  mkdirSync(artifacts, { recursive: true })
  const paths = ['first', 'second', 'global', 'missing'].map(name => join(temp, name, 'mise.toml'))
  const pins = paths.map((path, i) => ({ path, dir: join(temp, ['first', 'second', 'global', 'missing'][i]),
    kind: i === 2 ? 'global' : 'project', origin: i === 2 ? 'global' : 'manual', exists: i !== 3 }))
  const tools = [
    { name: 'jq', versions: [
      { version: '1.7.1', installed: true, active: true, sources: [{ path: paths[0], requestedVersion: '1.7' }, { path: paths[2], requestedVersion: '1.7' }] },
      { version: '1.8.1', installed: true, active: false, sources: [{ path: paths[1], requestedVersion: '1.8.1' }] },
      { version: '99.0.1', installed: true, active: false, sources: [] },
      { version: '20.0.0', installed: false, active: false, sources: [{ path: paths[0], requestedVersion: '20.0.0' }] },
    ] },
    { name: 'node', versions: [{ version: '22.0.0', installed: true, active: false, sources: [] }] },
  ]
  const bootstrap = join(temp, 'bootstrap.cjs')
  writeFileSync(bootstrap, `
    const { ipcMain } = require('electron'); const fs = require('node:fs'); const cp = require('node:child_process');
    globalThis.graphTools = ${JSON.stringify(tools)}; globalThis.graphChanges = []; globalThis.graphFail = false;
    const ok = { ok: true, code: 0, stdout: '', stderr: '' };
    const overrides = {
      'mise:detect': () => ({ installed: true, version: 'graph fixture', path: 'fixture' }),
      'mise:get-pins': () => ${JSON.stringify(pins)},
      'mise:list-installed': () => {
        if (globalThis.graphReadFail) throw new Error('TEST_ROWS_FAILED');
        return globalThis.graphTools;
      },
      'mise:read-config': (_event, path) => ({ path, content: '[tools]\\n', parsed: { tools: {} } }),
      'mise:list-remote': () => ['1.7.1', '1.8.1', '99.0.1', '22.0.0'].map(version => ({ version })),
      'mise:change-connection': async (event, payload) => {
        globalThis.graphChanges.push(payload.args);
        await new Promise(resolve => setTimeout(resolve, 100));
        let result = ok;
        if (globalThis.graphFail) result = { ok: false, code: 23, stdout: '', stderr: 'TEST_RECONNECT_FAILED' };
        else {
          const { from, to, action } = payload.args;
          const original = globalThis.graphTools.find(t => t.name === from.tool).versions.find(v => v.version === from.version);
          if (action === 'disable') {
            original.disabledSources = [...(original.disabledSources || []), ...original.sources.filter(s => s.path === from.configPath)];
            original.sources = original.sources.filter(s => s.path !== from.configPath);
          } else if (action === 'enable') {
            original.sources.push(...original.disabledSources.filter(s => s.path === from.configPath));
            original.disabledSources = original.disabledSources.filter(s => s.path !== from.configPath);
          } else {
            original.sources = original.sources.filter(s => s.path !== from.configPath);
          }
          if (to && !action) {
            const tool = globalThis.graphTools.find(t => t.name === to.tool);
            for (const v of tool.versions) v.sources = v.sources.filter(s => s.path !== to.configPath);
            tool.versions.find(v => v.version === to.version).sources.push({ path: to.configPath, requestedVersion: to.version });
          }
        }
        event.sender.send('mise:event:' + payload.reqId, { type: 'exit', data: '', code: result.code }); return result;
      },
    };
    const handle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, fn) => handle(channel, overrides[channel] || fn);
    const execFile = cp.execFile;
    cp.execFile = (file, args, opts, cb) => {
      if (/^reg(.exe)?$/i.test(file) && args[0] === 'export') {
        fs.writeFileSync(args[2], '\\ufeffWindows Registry Editor Version 5.00\\r\\n\\r\\n[HKEY_CURRENT_USER\\\\Environment]\\r\\n', 'utf16le');
        queueMicrotask(() => cb(null, '', '')); return;
      }
      throw Error('Unexpected command in graph fixture: ' + file);
    };
    cp.spawn = () => { throw Error('Real tool execution blocked in graph fixture'); };
    require(${JSON.stringify(resolve('dist-electron/main.cjs'))});
  `)
  const env = { ...process.env, APPDATA: join(temp, 'appdata') }
  for (const key of Object.keys(env)) if (/^(MISE_|XDG_)/i.test(key)) delete env[key]
  delete env.VITE_DEV_SERVER_URL; delete env.ELECTRON_RUN_AS_NODE
  let app, page
  const errors = [], checks = []
  const check = async (name, fn) => { await fn(); checks.push(name); console.log('✓ ' + name) }
  try {
    app = await _electron.launch({ args: [bootstrap, '--user-data-dir=' + join(temp, 'chromium')], env, cwd: temp })
    page = await app.firstWindow(); page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(error.message))
    await page.evaluate(() => localStorage.setItem('mise-gui.lang', 'zh')); await page.reload()
    await page.locator('.nav').getByRole('button', { name: '工具管理', exact: true }).click()
    const line = (version, path, tool = 'jq') => page.getByRole('button', { name: `选择连线 ${tool}@${version} → ${path}`, exact: true })
    const select = async (version, path, tool) => {
      const el = line(version, path, tool)
      await expect(el).toHaveCount(1)
      // Click an actually exposed piece of the SVG stroke, never dispatch a fake click.
      await el.scrollIntoViewIfNeeded()
      const point = await el.evaluate(path => {
        const matrix = path.getScreenCTM()
        for (let n = 4; n < path.getTotalLength(); n += 4) {
          const p = path.getPointAtLength(n).matrixTransform(matrix), x = p.x, y = p.y
          if (document.elementFromPoint(x, y) === path) return { x, y }
        }
      })
      assert.ok(point, 'connection needs an exposed clickable segment')
      await page.mouse.click(point.x, point.y)
      await expect(el).toHaveAttribute('aria-pressed', 'true')
    }
    const begin = async end => {
      await page.getByRole('button', { name: '适应画布', exact: true }).click()
      const handle = page.locator(`[data-edge-end="${end}"]`)
      await handle.scrollIntoViewIfNeeded()
      const r = await handle.boundingBox()
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down()
      await page.mouse.move(r.x + r.width / 2 - 20, r.y + r.height / 2 + 10, { steps: 3 })
      await expect(page.locator('[data-cable-preview]')).toHaveCount(1)
    }
    const grabStroke = async (version, path, end) => {
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: '适应画布', exact: true }).click()
      const hit = line(version, path)
      const point = await hit.evaluate((path, end) => {
        const matrix = path.getScreenCTM(), len = path.getTotalLength()
        const a = path.getPointAtLength(0).matrixTransform(matrix), b = path.getPointAtLength(len).matrixTransform(matrix)
        for (let n = 20; n < len - 20; n += 4) {
          const p = path.getPointAtLength(n).matrixTransform(matrix)
          const nearSource = Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(p.x - b.x, p.y - b.y)
          if (nearSource === (end === 'source') && document.elementFromPoint(p.x, p.y) === path) return { x: p.x, y: p.y }
        }
      }, end)
      assert.ok(point, 'wire needs an exposed segment near the chosen end')
      await page.mouse.move(point.x, point.y); await page.mouse.down()
      await page.mouse.move(point.x - 10, point.y - 8, { steps: 2 })
      await expect(page.locator('[data-cable-preview]')).toHaveCount(1)
      await expect(page.locator('.edge-actions')).toHaveCount(0)
    }
    const drop = async (target, direct = false) => {
      const over = () => target.evaluate(el => el.closest('[data-vkey],[data-tool],[data-pin]').classList.contains('cable-over'))
      // Canvas auto-pan may move a node during the approach. Follow its current
      // position like a pointer user, instead of waiting for native scrolling.
      for (let i = 0; i < 4; i++) {
        const r = await target.boundingBox()
        await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
        if (await over()) break
      }
      await expect.poll(over).toBe(true)
      if (direct) await expect(page.locator('.canvas-cable-status')).toContainText('松开即可切换版本')
      await page.mouse.up()
      return page.getByRole('dialog')
    }
    const pin = index => page.locator('[data-pin]').filter({ has: page.getByText(pins[index].dir, { exact: true }) })
    const confirm = async dialog => { await dialog.locator('.modal-foot .primary').click(); await expect(dialog).toHaveCount(0) }
    const camera = () => page.locator('.canvas-world').evaluate(el => {
      const m = new DOMMatrix(getComputedStyle(el).transform)
      return { x: m.e, y: m.f, scale: m.a }
    })
    const node = id => page.locator('[data-canvas-node]').filter({ has: page.locator(`[data-node-drag=${JSON.stringify(id)}]`) })
    const position = id => node(id).evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }))
    const dragNode = async (id, dx, dy, cancel) => {
      const handle = page.locator(`[data-node-drag=${JSON.stringify(id)}]`), r = await handle.boundingBox()
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down()
      await page.mouse.move(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy, { steps: 5 })
      if (cancel === 'Escape') await page.keyboard.press('Escape')
      if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await page.mouse.up()
    }
    const assertEndpoints = async () => {
      await expect.poll(() => page.locator('[data-edge]').evaluateAll(paths => paths.every(path => {
        const fold = p => p.toLowerCase().replaceAll('/', '\\')
        const source = [...document.querySelectorAll(path.dataset.source === 'version' ? '[data-vkey]' : '[data-tool]')]
          .find(el => (el.dataset.vkey ?? el.dataset.tool) === path.dataset.sourceKey)
        const target = path.dataset.targetKey === 'idle' ? document.querySelector('[data-bucket]')
          : [...document.querySelectorAll('[data-pin]')].find(el => fold(el.dataset.pin) === path.dataset.targetKey)
        const s = source.getBoundingClientRect(), t = target.getBoundingClientRect(), matrix = path.getScreenCTM()
        const a = path.getPointAtLength(0).matrixTransform(matrix), b = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix)
        const x = path.dataset.source === 'version' ? s.left : s.left + s.width / 2
        const y = path.dataset.source === 'version' ? s.top + s.height / 2 : s.bottom
        const side = path.classList.contains('lk-on') ? 'left' : 'right'
        return Math.abs(a.x - x) < 1 && Math.abs(a.y - y) < 1 && Math.abs(b.x - t[side]) < 1
          && b.y > t.top && b.y < t.bottom && path.dataset.targetSide === side
      }))).toBe(true)
    }

    await check('command output docks to the right, collapses independently and remembers its state', async () => {
      await expect(page.locator('.topbar .canvas-toolbar')).toHaveCount(1)
      await expect(page.locator('.tools-board > .canvas-toolbar')).toHaveCount(0)
      for (const name of ['查看文档', '+ 添加工具']) {
        const button = page.locator('.topbar').getByRole('button', { name, exact: true })
        await expect(button).toHaveText('')
        await expect(button.locator('svg')).toHaveCount(1)
      }
      const aligned = () => page.evaluate(() => {
        if (!document.querySelector('.canvas-footer') || !document.querySelector('.topbar .canvas-toolbar')) return false
        const header = document.querySelector('.topbar').getBoundingClientRect()
        const foot = document.querySelector('.canvas-footer').getBoundingClientRect(), side = document.querySelector('.sidebar-foot').getBoundingClientRect()
        const controls = [...document.querySelectorAll('.topbar button')].map(el => el.getBoundingClientRect())
        return header.height <= 50 && controls.every(r => r.left >= header.left && r.right <= header.right && Math.abs(r.top + r.height / 2 - header.top - header.height / 2) < 1)
          && Math.abs(foot.top - side.top) < 1 && Math.abs(foot.height - side.height) < 1 && document.documentElement.scrollWidth <= innerWidth
      })
      for (const lang of ['zh', 'en']) {
        await page.evaluate(lang => localStorage.setItem('mise-gui.lang', lang), lang); await page.reload()
        for (const width of [900, 1180, 1440]) {
          await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 780), width)
          await expect.poll(aligned).toBe(true)
        }
      }
      await page.evaluate(() => localStorage.setItem('mise-gui.lang', 'zh')); await page.reload()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 780))
      await expect.poll(aligned).toBe(true)
      const right = await page.locator('.command-sidebar').boundingBox(), main = await page.locator('.main').boundingBox()
      assert.ok(right.x >= main.x + main.width - 1 && right.height > 500)
      const bounds = await page.evaluate(() => Object.fromEntries(['.workspace', '.main', '.content', '.tool-canvas', '.canvas-footer', '.command-sidebar']
        .map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [selector, { top: r.top, bottom: r.bottom, height: r.height, viewport: innerHeight }] })))
      assert.ok(bounds['.canvas-footer'].bottom <= bounds['.main'].viewport + 1, JSON.stringify(bounds))
      await page.screenshot({ path: join(artifacts, 'command-sidebar-right.png'), fullPage: true })
      await page.locator('.console').getByRole('button', { name: '收起', exact: true }).click()
      await expect(page.locator('.console-body')).toHaveCount(0)
      await expect(page.locator('button.console-rail')).toHaveAttribute('aria-expanded', 'false')
      assert.ok((await page.locator('.main').boundingBox()).width > main.width + 100)
      await page.screenshot({ path: join(artifacts, 'command-sidebar-collapsed.png'), fullPage: true })
      await page.reload()
      await expect(page.locator('button.console-rail')).toBeVisible()
      await page.locator('button.console-rail').click()
      await expect(page.locator('.console-body')).toBeVisible()
      await page.locator('.titlebar-toggle').click()
      await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
      await expect.poll(aligned).toBe(true)
      await page.locator('.titlebar-toggle').click()
      await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/)
      await page.locator('.console').getByRole('button', { name: '收起', exact: true }).click()
      await page.screenshot({ path: join(artifacts, 'unified-tools-header.png'), fullPage: true })
    })
    await check('canvas nodes have no connection action buttons', async () => {
      await expect(page.locator('.canvas-node').getByRole('button', { name: /^(切换版本|连接工具|连接到配置)$/ })).toHaveCount(0)
      await expect(page.locator('[data-cable-tool]')).toHaveCount(2)
    })
    await check('solid and dashed cables use separate config sides, including during endpoint dragging', async () => {
      await assertEndpoints()
      await expect(page.locator('[data-target-port]')).toHaveCount(6)
      await select('20.0.0', paths[0]); await begin('source')
      const fixed = await page.locator('[data-cable-preview]').evaluate(path => {
        const a = path.getPointAtLength(0).matrixTransform(path.getScreenCTM())
        return { x: a.x, y: a.y }
      })
      const r = await pin(0).boundingBox()
      assert.ok(Math.abs(fixed.x - r.x - r.width) < 1 && fixed.y > r.y && fixed.y < r.y + r.height)
      await page.keyboard.press('Escape'); await page.mouse.up()
      await begin('target')
      const target = await pin(1).boundingBox()
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2)
      await expect.poll(() => page.locator('[data-cable-preview]').evaluate(path => {
        const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM())
        const t = [...document.querySelectorAll('[data-pin]')].find(el => el.classList.contains('cable-over'))?.getBoundingClientRect()
        return !!t && Math.abs(end.x - t.right) < 1 && Math.abs(end.y - t.top - t.height / 2) < 1
      })).toBe(true)
      await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.press('Escape')
      await page.screenshot({ path: join(artifacts, 'config-side-ports.png'), fullPage: true })
    })
    await check('canvas nodes drag independently and cables follow their exact endpoints', async () => {
      await expect(page.locator('[data-canvas-node]')).toHaveCount(7)
      const before = await position('tool:jq'), other = await position('tool:node'), scale = (await camera()).scale
      await dragNode('tool:jq', 70, 30)
      const after = await position('tool:jq')
      assert.ok(Math.abs(after.x - before.x - 70 / scale) < 1)
      assert.ok(Math.abs(after.y - before.y - 30 / scale) < 1)
      assert.deepEqual(await position('tool:node'), other, 'dragging one node cannot reflow a neighbour')
      await assertEndpoints()
      const pinId = `pin:${paths[0].toLowerCase().replaceAll('/', '\\')}`
      // Move a config above the tool band; routing must work in every direction.
      await page.getByRole('button', { name: '适应画布', exact: true }).click()
      await dragNode(pinId, -80, -220)
      await page.getByRole('button', { name: '适应画布', exact: true }).click()
      await assertEndpoints()
      assert.equal(await app.evaluate(() => globalThis.graphChanges.length), 0)
    })
    await check('blank-space dragging pans without moving nodes and Ctrl-wheel keeps the cursor anchor', async () => {
      const before = await camera(), p = await position('tool:jq'), r = await page.locator('.tool-canvas').boundingBox()
      await page.mouse.move(r.x + 5, r.y + r.height / 2); await page.mouse.down()
      await page.mouse.move(r.x + 85, r.y + r.height / 2 + 30, { steps: 5 }); await page.mouse.up()
      const after = await camera()
      assert.ok(Math.abs(after.x - before.x - 80) < 1 && Math.abs(after.y - before.y - 30) < 1)
      assert.deepEqual(await position('tool:jq'), p)
      const at = { x: r.width / 2, y: r.height / 2 }, old = await camera()
      await page.mouse.move(r.x + at.x, r.y + at.y); await page.keyboard.down('Control')
      await page.mouse.wheel(0, -100); await page.keyboard.up('Control')
      await expect.poll(async () => (await camera()).scale).toBeGreaterThan(old.scale)
      const z = await camera()
      assert.ok(Math.abs((at.x - old.x) / old.scale - (at.x - z.x) / z.scale) < 1)
      assert.ok(Math.abs((at.y - old.y) / old.scale - (at.y - z.y) / z.scale) < 1)
      await assertEndpoints()
      await page.getByRole('button', { name: '适应画布', exact: true }).click()
      await page.locator('.tool-canvas').focus(); await page.keyboard.down('Space')
      const source = await page.locator('[data-vkey="jq@1.7.1"] .version-handle').boundingBox(), c = await camera()
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down()
      await page.mouse.move(source.x + source.width / 2 + 30, source.y + source.height / 2 + 20)
      await page.mouse.up(); await page.keyboard.up('Space')
      await expect(page.locator('[data-cable-preview]')).toHaveCount(0)
      const moved = await camera()
      assert.ok(Math.abs(moved.x - c.x - 30) < 1 && Math.abs(moved.y - c.y - 20) < 1, 'Space-drag pans without starting a cable')
    })
    await check('node gestures cancel on Escape and blur, and layout survives renderer reload', async () => {
      await page.getByRole('button', { name: '适应画布', exact: true }).click()
      for (const cancel of ['Escape', 'blur']) {
        const before = await position('tool:jq')
        await dragNode('tool:jq', 35, 20, cancel)
        assert.deepEqual(await position('tool:jq'), before)
      }
      const p = await position('tool:jq'), c = await camera()
      await page.reload()
      await page.locator('.nav').getByRole('button', { name: '工具管理', exact: true }).click()
      await expect(page.locator('[data-tool="jq"]')).toHaveCount(1)
      assert.deepEqual(await position('tool:jq'), p)
      await expect.poll(async () => {
        const restored = await camera()
        return Math.abs(restored.x - c.x) < 1 && Math.abs(restored.y - c.y) < 1 && Math.abs(restored.scale - c.scale) < .001
      }).toBe(true)
      await assertEndpoints()
      await page.getByRole('button', { name: '整理布局', exact: true }).click()
      await expect.poll(() => position('tool:jq')).toEqual({ x: 64, y: 56 })
      await assertEndpoints()
      assert.equal(await app.evaluate(() => globalThis.graphChanges.length), 0)
      await page.screenshot({ path: join(artifacts, 'tool-canvas.png'), fullPage: true })
    })
    await check('automatic fit follows refreshed node sizes while preserving the user layout', async () => {
      await app.evaluate(() => {
        globalThis.graphOriginal = structuredClone(globalThis.graphTools)
        for (let i = 0; i < 3; i++) globalThis.graphTools[0].versions.push({ version: `fixture-${i}`, installed: true, active: false, sources: [] })
      })
      await page.locator('.topbar').getByRole('button', { name: '刷新', exact: true }).click()
      await expect(page.locator('[data-vkey="jq@fixture-2"]')).toHaveCount(1)
      await expect.poll(() => page.locator('[data-canvas-node]').evaluateAll(nodes => {
        const r = document.querySelector('.tool-canvas').getBoundingClientRect()
        return nodes.every(node => { const n = node.getBoundingClientRect(); return n.left >= r.left && n.right <= r.right && n.top >= r.top && n.bottom <= r.bottom })
      })).toBe(true)
      await assertEndpoints()
      await app.evaluate(() => { globalThis.graphTools = globalThis.graphOriginal })
      await page.locator('.topbar').getByRole('button', { name: '刷新', exact: true }).click()
      await expect(page.locator('[data-vkey="jq@fixture-2"]')).toHaveCount(0)
    })
    await check('connections remain visible and clickable over an overlapping node', async () => {
      await page.getByRole('button', { name: '适应画布', exact: true }).click()
      const connection = line('1.7.1', paths[0])
      const target = await connection.evaluate(path => { const p = path.getPointAtLength(path.getTotalLength() * .55).matrixTransform(path.getScreenCTM()); return { x: p.x, y: p.y } })
      const card = await page.locator('[data-tool="node"]').boundingBox(), scale = (await camera()).scale
      await dragNode('tool:node', target.x - card.x - 180 * scale, target.y - card.y - 70 * scale)
      const r = await page.locator('[data-tool="node"]').boundingBox()
      assert.ok(target.x >= r.x && target.x <= r.x + r.width && target.y >= r.y && target.y <= r.y + r.height)
      assert.equal(await connection.evaluate((path, p) => document.elementFromPoint(p.x, p.y) === path, target), true)
      await page.mouse.click(target.x, target.y)
      await expect(connection).toHaveAttribute('aria-pressed', 'true')
      await assertEndpoints()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: '整理布局', exact: true }).click()
    })

    await check('requested-version ports remain draggable above the interactive line layer', async () => {
      const handle = page.locator('[data-vkey="jq@1.7.1"] .version-handle')
      await handle.scrollIntoViewIfNeeded(); const r = await handle.boundingBox()
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down()
      await page.mouse.move(r.x - 15, r.y + 20)
      await expect(page.locator('[data-cable-preview]')).toHaveCount(1)
      await page.keyboard.press('Escape'); await page.mouse.up()
      await expect(page.locator('[data-cable-preview]')).toHaveCount(0)
    })
    await check('real SVG strokes select connections and expose two editable endpoints', async () => {
      await page.keyboard.press('Escape')
      const before = await camera(), bounds = await page.locator('.tool-canvas').boundingBox()
      await select('1.7.1', paths[0])
      await expect(page.locator('[data-edge-end]')).toHaveCount(2)
      assert.deepEqual(await page.locator('.tool-canvas').boundingBox(), bounds, 'selection cannot resize the canvas')
      assert.deepEqual(await camera(), before, 'selection cannot move the camera')
      const actions = await page.locator('.edge-actions').boundingBox()
      assert.ok(actions.width < 160 && actions.height < 42, 'only a compact floating icon bar is shown')
      await expect(page.locator('.tool-link-controls path')).toHaveCount(4)
      for (const factor of [1, .5]) {
        if (factor === .5) await page.getByRole('button', { name: '缩小画布', exact: true }).click()
        const handle = await page.locator('[data-edge-end="source"]').boundingBox()
        assert.ok(Math.abs(handle.width - 32) < 1 && Math.abs(handle.height - 32) < 1, 'endpoint stays easy to grab when zoomed out')
      }
      await page.screenshot({ path: join(artifacts, 'compact-edge-selection.png'), fullPage: true })
    })
    await check('wires drag without preselection and drop targets remain reachable through crossing cables', async () => {
      for (const end of ['source', 'target']) {
        await grabStroke('1.7.1', paths[0], end)
        await page.keyboard.press('Escape'); await page.mouse.up()
        await expect(line('1.7.1', paths[0])).toHaveCount(1)
      }
      await page.keyboard.press('Escape')
      const port = page.locator('[data-port-edge]').filter({ hasNot: page.locator('[data-edge-end]') }).first()
      const r = await port.boundingBox()
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down()
      await page.mouse.move(r.x + r.width / 2 + 12, r.y + r.height / 2 - 12)
      await expect(page.locator('[data-cable-preview]')).toHaveCount(1)
      await expect(page.locator('.edge-actions')).toHaveCount(0)
      await page.keyboard.press('Escape'); await page.mouse.up()
      await select('1.7.1', paths[0])
    })
    await check('target-end dragging previews a move, cancellation retains both connections', async () => {
      await begin('target')
      const dialog = await drop(pin(1))
      await expect(dialog.locator('#connection-config')).toHaveValue(paths[1])
      await expect(dialog.locator('[data-version="1.7.1"]')).toHaveAttribute('aria-pressed', 'true')
      await expect(dialog.locator('.edge-original')).toContainText(paths[0])
      await dialog.locator('.modal-foot').getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(await app.evaluate(() => globalThis.graphChanges.length), 0)
    })
    await check('both outside halves of config ports accept drops without accidental writes', async () => {
      for (const side of ['left', 'right']) {
        await select('1.7.1', paths[0]); await begin('target')
        const r = await pin(1).boundingBox()
        await page.mouse.move(side === 'left' ? r.x - 8 : r.x + r.width + 8, r.y + r.height / 2)
        await expect(pin(1)).toHaveClass(/cable-over/)
        await page.mouse.up()
        const dialog = page.getByRole('dialog')
        await expect(dialog.locator('#connection-config')).toHaveValue(paths[1])
        await dialog.locator('.modal-foot').getByRole('button', { name: '取消', exact: true }).click()
      }
      assert.equal(await app.evaluate(() => globalThis.graphChanges.length), 0)
    })
    await check('solid cables disable on the same config right side and restore from the left after reload', async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
      const before = await app.evaluate(() => globalThis.graphChanges.length)
      await select('1.7.1', paths[2]); await begin('target')
      let r = await pin(2).boundingBox()
      await page.mouse.move(r.x + r.width + 8, r.y + r.height / 2)
      await expect(page.locator('.canvas-cable-status')).toContainText('松开即可停用')
      await page.mouse.up()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.tool-links path.lk-disabled')).toHaveCount(1)
      await expect(line('1.7.1', paths[0])).toHaveCount(1)
      await expect(page.locator('[data-vkey="jq@1.7.1"]')).toHaveCount(1)
      await assertEndpoints()
      await page.reload()
      await expect(page.locator('.tool-links path.lk-disabled')).toHaveCount(1)
      await select('1.7.1', paths[2]); await begin('target')
      r = await pin(2).boundingBox()
      await page.mouse.move(r.x - 8, r.y + r.height / 2)
      await expect(page.locator('.canvas-cable-status')).toContainText('松开即可恢复启用')
      await page.mouse.up()
      await expect(page.locator('.tool-links path.lk-disabled')).toHaveCount(0)
      await expect(page.locator('.tool-links path.lk-on')).toHaveCount(3)
      await assertEndpoints()
      assert.equal(await app.evaluate(() => globalThis.graphChanges.length), before + 2)
      // Keep later independent checks' expected mutation counts unchanged.
      await app.evaluate(() => { globalThis.graphChanges = [] })
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 780))
      await select('1.7.1', paths[0])
    })
    await check('target-end confirmation moves only the selected request', async () => {
      await begin('target'); const dialog = await drop(pin(1))
      await dialog.locator('.modal-foot .primary').hover()
      await expect(page.locator('.cmd-tip code')).toContainText('mise unuse jq@1.7 --no-prune')
      await confirm(dialog)
      await expect(line('1.7.1', paths[0])).toHaveCount(0)
      await expect(line('1.7.1', paths[1])).toHaveCount(1)
      await expect(line('1.7.1', paths[2])).toHaveCount(1)
    })
    await check('dropping on exact versions switches immediately while tool nodes still open the picker', async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
      await grabStroke('1.7.1', paths[1], 'source')
      const before = await app.evaluate(() => globalThis.graphChanges.length)
      await drop(page.locator('[data-vkey="jq@1.8.1"]'), true)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(line('1.8.1', paths[1])).toHaveCount(1)
      assert.equal(await app.evaluate(() => globalThis.graphChanges.length), before + 1)
      await expect(line('1.7.1', paths[2])).toHaveCount(1)
      await select('1.8.1', paths[1]); await begin('source')
      const dialog = await drop(page.locator('[data-tool="node"] .tool-head'))
      await expect(dialog.locator('#connection-version')).toBeVisible()
      await expect(dialog.locator('.modal-foot .primary')).toBeDisabled()
      await dialog.locator('.modal-foot').getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(await app.evaluate(() => globalThis.graphChanges.length), before + 1)
      await select('1.8.1', paths[1]); await begin('source')
      await drop(page.locator('[data-vkey="node@22.0.0"]'), true)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(line('1.8.1', paths[1])).toHaveCount(0)
      await expect(line('22.0.0', paths[1], 'node')).toHaveCount(1)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 780))
    })
    await check('failed immediate version drops keep the original connection and release controls', async () => {
      await app.evaluate(() => { globalThis.graphFail = true })
      const before = await app.evaluate(() => globalThis.graphChanges.length)
      await select('22.0.0', paths[1], 'node'); await begin('source')
      await drop(page.locator('[data-vkey="jq@1.8.1"]'), true)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.toast')).toContainText('连接失败')
      await expect(line('22.0.0', paths[1], 'node')).toHaveCount(1)
      await expect(line('1.8.1', paths[1])).toHaveCount(0)
      await expect(page.locator('.edge-actions').getByRole('button', { name: '更换配置', exact: true })).toBeEnabled()
      assert.equal(await app.evaluate(() => globalThis.graphChanges.length), before + 1)
      await app.evaluate(() => { globalThis.graphFail = false })
    })
    await check('delete supports cancellation, keyboard activation, and keeps installations', async () => {
      await select('1.7.1', paths[2])
      await page.locator('.edge-actions').getByRole('button', { name: '删除连线', exact: true }).click()
      let dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('保留本机安装')
      await dialog.locator('.modal-foot').getByRole('button', { name: '取消', exact: true }).click()
      await line('22.0.0', paths[1], 'node').focus(); await page.keyboard.press('Delete')
      dialog = page.getByRole('dialog')
      await expect(dialog.locator('.confirm-target')).toHaveText('node@22.0.0')
      await dialog.locator('.modal-foot').getByRole('button', { name: '取消', exact: true }).click()
      await select('1.7.1', paths[2])
      await line('1.7.1', paths[2]).focus(); await page.keyboard.press('Delete')
      dialog = page.getByRole('dialog')
      await dialog.locator('.confirm-danger').click(); await expect(dialog).toHaveCount(0)
      await expect(line('1.7.1', paths[2])).toHaveCount(0)
      await expect(page.locator('[data-vkey="jq@1.7.1"]')).toHaveCount(1)
      await expect(line('22.0.0', paths[1], 'node')).toHaveCount(1)
    })
    await check('failed edits preserve the picker, release controls and prevent duplicate submits', async () => {
      await select('22.0.0', paths[1], 'node')
      await page.locator('.edge-actions').getByRole('button', { name: '更换配置', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('#connection-config').selectOption(paths[0])
      await app.evaluate(() => { globalThis.graphFail = true })
      const before = await app.evaluate(() => globalThis.graphChanges.length)
      await dialog.locator('.modal-foot .primary').evaluate(button => { button.click(); button.click() })
      await expect(dialog.getByRole('alert')).toContainText('TEST_RECONNECT_FAILED')
      await expect(dialog.locator('.modal-foot .primary')).toBeEnabled()
      assert.equal(await app.evaluate(() => globalThis.graphChanges.length), before + 1)
      await app.evaluate(() => { globalThis.graphFail = false })
      await confirm(dialog)
      await expect(line('22.0.0', paths[0], 'node')).toHaveCount(1)
    })
    await check('missing project targets and blank drops cancel without editing', async () => {
      const before = await app.evaluate(() => globalThis.graphChanges.length)
      await select('22.0.0', paths[0], 'node'); await begin('target')
      await pin(3).scrollIntoViewIfNeeded(); const r = await pin(3).boundingBox()
      await page.mouse.move(r.x + 30, r.y + 30); await page.mouse.up()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await begin('source'); await page.mouse.move(10, 150); await page.mouse.up()
      await expect(page.locator('[data-cable-preview], .overlay')).toHaveCount(0)
      assert.equal(await app.evaluate(() => globalThis.graphChanges.length), before)
      assert.deepEqual(errors, [])
      await page.screenshot({ path: join(artifacts, 'editable-tool-graph.png'), fullPage: true })
    })
    await check('view and task IPC rejections remain recoverable without stuck busy state', async () => {
      await app.evaluate(() => {
        globalThis.graphReadFail = true
      })
      await page.locator('.topbar').getByRole('button', { name: '刷新', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('TEST_ROWS_FAILED')
      await expect(page.getByRole('heading', { name: '加载失败，请重试', exact: true })).toBeVisible()
      await app.evaluate(({ ipcMain }) => {
        globalThis.graphReadFail = false
        ipcMain.removeHandler('mise:list-tasks'); ipcMain.handle('mise:list-tasks', () => [{ name: 'ipc-failure', source: 'fixture' }])
        ipcMain.removeHandler('mise:run-task'); ipcMain.handle('mise:run-task', () => { throw new Error('TEST_TASK_REJECTED') })
      })
      await page.locator('.empty').getByRole('button', { name: '刷新', exact: true }).click()
      await expect(page.locator('[data-tool="jq"]')).toHaveCount(1)
      await page.locator('.nav').getByRole('button', { name: '任务', exact: true }).click()
      const run = page.locator('.task-row').getByRole('button', { name: '运行', exact: true })
      await run.click(); await expect(run).toBeEnabled()
      await expect(page.locator('.toast')).toContainText('失败')
      await page.locator('button.console-rail').click()
      await expect(page.locator('.console-body')).toContainText('TEST_TASK_REJECTED')
      assert.deepEqual(errors, [])
    })
    console.log(`All ${checks.length} editable graph checks passed; no real tool commands ran.`)
  } catch (error) {
    if (page) await page.screenshot({ path: join(artifacts, 'editable-graph-failure.png') }).catch(() => {})
    throw error
  } finally {
    if (app) await app.close().catch(() => {})
    writeFileSync(join(artifacts, 'editable-graph-report.json'), JSON.stringify({ checks, errors }, null, 2))
    assert.ok(temp.startsWith(join(tmpdir(), 'mise-gui-graph-')))
    rmSync(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
