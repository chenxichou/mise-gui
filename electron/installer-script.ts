// Keep release selection, checksum verification and installation in the official
// script. Only replace its HTTP transport: PS 5.1 otherwise hides all download
// progress and can wait indefinitely before trying the official fallback host.
export function windowsDownloadHelpers(limits = { connect: 15, stall: 30, download: 480, metadata: 60 }) {
  return String.raw`
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$script:MiseGuiCurl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
function Invoke-WebRequest {
  param([string] $Uri, [string] $OutFile, [switch] $UseBasicParsing)
  [Console]::Error.WriteLine("mise-gui: requesting $Uri")
  $seconds = if ($OutFile) { ${limits.download} } else { ${limits.metadata} }
  if ($script:MiseGuiCurl) {
    $curlArgs = @('--fail', '--location', '--show-error', '--connect-timeout', '${limits.connect}', '--speed-time', '${limits.stall}', '--speed-limit', '1024', '--max-time', "$seconds")
    if ($OutFile) { $curlArgs += @('--progress-bar', '--output', $OutFile) }
    else { $curlArgs += '--silent' }
    $content = & $script:MiseGuiCurl.Source @curlArgs -- $Uri
    if ($LASTEXITCODE -ne 0) { throw "Download failed (curl exit $LASTEXITCODE): $Uri. Check network/proxy settings and retry." }
    [Console]::Error.WriteLine("mise-gui: received $Uri")
    if (-not $OutFile) { return [pscustomobject]@{ Content = ($content -join [Environment]::NewLine) } }
  } else {
    [Console]::Error.WriteLine("mise-gui: curl.exe unavailable; using PowerShell HTTP (timeout $seconds seconds)")
    # PS 5.1's Invoke-WebRequest -TimeoutSec can stop enforcing its deadline
    # after headers arrive. Wait on the whole transfer and cancel explicitly.
    $client = New-Object Net.WebClient
    $client.Encoding = [Text.Encoding]::UTF8
    try {
      $task = if ($OutFile) { $client.DownloadFileTaskAsync([uri]$Uri, $OutFile) } else { $client.DownloadStringTaskAsync([uri]$Uri) }
      if (-not $task.Wait($seconds * 1000)) {
        $client.CancelAsync()
        throw "Download timed out after $seconds seconds: $Uri. Check network/proxy settings and retry."
      }
      [Console]::Error.WriteLine("mise-gui: received $Uri")
      if (-not $OutFile) { return [pscustomobject]@{ Content = $task.GetAwaiter().GetResult() } }
    } finally {
      $client.Dispose()
    }
  }
}
`
}

export const windowsInstallerScript = windowsDownloadHelpers() + String.raw`
try {
  $installer = (Invoke-WebRequest -UseBasicParsing -Uri 'https://mise.run/powershell').Content
  Invoke-Expression $installer
  exit 0
} catch {
  [Console]::Error.WriteLine($_)
  exit 1
}
`
