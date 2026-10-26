// Only local HTTP fixtures and harmless child processes. Never fetch or execute
// the official installer, create mise binaries, or write the user PATH.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { windowsDownloadHelpers } from '../electron/installer-script.ts'
import { runStream } from '../electron/mise.ts'

const events: { type: string; data: string; code?: number }[] = []
let sawLiveProgress = false
const streamed = await runStream(process.execPath, ['-e',
  'process.stdout.write("10%\\r"); setTimeout(() => { process.stdout.write("100%\\r\\n"); }, 100); setTimeout(() => {}, 60000)',
], undefined, event => {
  events.push(event)
  if (event.data === '10%') sawLiveProgress = true
}, 500)
assert.ok(sawLiveProgress, 'carriage-return progress must appear before termination')
assert.equal(streamed.ok, false)
assert.match(streamed.stderr, /terminated.*timed out/)
assert.equal(events.filter(e => e.type === 'exit').length, 1)

const priorStderr = await runStream(process.execPath, ['-e',
  'console.error("mise: installing mise..."); setTimeout(() => {}, 60000)',
], undefined, () => {}, 500)
assert.match(priorStderr.stderr, /installing mise[\s\S]*terminated/)
console.log('✓ streamed carriage-return progress and timeout after earlier stderr')

if (process.platform !== 'win32') {
  console.log('Windows HTTP transport checks skipped on this platform')
} else {
  const temp = mkdtempSync(join(tmpdir(), 'mise-gui-http-'))
  const payload = Buffer.alloc(128 * 1024, 'x')
  const requested: string[] = []
  const server = createServer((req, res) => {
    requested.push(req.url || '')
    if (req.url === '/text') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.from('fixture 中文\nsecond line', 'utf8'))
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/archive' }); res.end()
    } else if (req.url === '/archive') {
      res.writeHead(200, { 'Content-Length': payload.length })
      res.write(payload.subarray(0, 1024))
      const timer = setTimeout(() => res.end(payload.subarray(1024)), 250)
      res.on('close', () => clearTimeout(timer))
    } else if (req.url === '/stall') {
      res.writeHead(200, { 'Content-Length': payload.length })
      res.write(payload.subarray(0, 16))
      // Leave the rest unanswered; the downloader must abort on low speed.
    } else {
      res.writeHead(503); res.end('fixture unavailable')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const psLiteral = (text: string) => "'" + text.replaceAll("'", "''") + "'"
  const file = join(temp, 'download.bin')
  const helpers = windowsDownloadHelpers({ connect: 1, stall: 1, download: 3, metadata: 2 })
  const run = (body: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const script = helpers + '\n' + body
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 12000,
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data.toString() })
    child.stderr.on('data', data => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
  try {
    const text = await run(`(Invoke-WebRequest -UseBasicParsing -Uri '${base}/text').Content`)
    assert.equal(text.code, 0, text.stderr)
    assert.match(text.stdout, /fixture 中文[\s\S]*second line/)
    console.log('✓ real Windows curl transport preserves UTF-8 metadata')

    const download = await run(`Invoke-WebRequest -UseBasicParsing -Uri '${base}/redirect' -OutFile ${psLiteral(file)}`)
    assert.equal(download.code, 0, download.stderr)
    assert.deepEqual(readFileSync(file), payload)
    assert.match(download.stderr, /requesting.*redirect[\s\S]*100.*received/s)
    console.log('✓ real Windows curl follows redirects and reports archive progress')

    const started = Date.now()
    const fallback = await run(`
      $downloaded = $false
      foreach ($url in @('${base}/stall', '${base}/archive')) {
        try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile ${psLiteral(file)}; $downloaded = $true; break }
        catch { [Console]::Error.WriteLine("fixture fallback: $_") }
      }
      if (-not $downloaded) { exit 1 }
    `)
    assert.equal(fallback.code, 0, fallback.stderr)
    assert.ok(Date.now() - started < 10000, 'stall must fail promptly')
    assert.match(fallback.stderr, /fixture fallback[\s\S]*requesting.*archive/s)
    assert.deepEqual(readFileSync(file), payload, 'fallback replaces the partial download')
    console.log('✓ stalled source times out and a successful fallback replaces partial data')

    const failed = await run(`
      try { Invoke-WebRequest -UseBasicParsing -Uri '${base}/failed'; exit 0 }
      catch { [Console]::Error.WriteLine($_); exit 1 }
    `)
    assert.equal(failed.code, 1)
    assert.match(failed.stderr, /curl exit 22/)
    console.log('✓ HTTP failure is actionable and never masquerades as success')

    const noCurl = await run(`
      $script:MiseGuiCurl = $null
      (Invoke-WebRequest -UseBasicParsing -Uri '${base}/text').Content
      Invoke-WebRequest -UseBasicParsing -Uri '${base}/archive' -OutFile ${psLiteral(file)}
    `)
    assert.equal(noCurl.code, 0, noCurl.stderr)
    assert.match(noCurl.stdout, /fixture 中文/)
    assert.deepEqual(readFileSync(file), payload)
    assert.match(noCurl.stderr, /curl.exe unavailable/)
    console.log('✓ machines without curl use bounded PowerShell HTTP for metadata and files')

    const noCurlTimeout = await run(`
      $script:MiseGuiCurl = $null
      try { Invoke-WebRequest -UseBasicParsing -Uri '${base}/stall' -OutFile ${psLiteral(file)}; exit 0 }
      catch { [Console]::Error.WriteLine('fixture PowerShell timeout'); exit 1 }
    `)
    assert.equal(noCurlTimeout.code, 1, noCurlTimeout.stderr)
    assert.match(noCurlTimeout.stderr, /fixture PowerShell timeout/)
    console.log('✓ PowerShell fallback also terminates stalled downloads')
    assert.ok(requested.includes('/stall'))
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(temp, { recursive: true, force: true })
  }
}
