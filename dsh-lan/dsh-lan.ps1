<#
  dsh-lan.ps1 - run the DSH Web GUI with a LAN-side forwarder in front of it (Windows entry).

  Same tool, same name, three suffixes: dsh-lan.ps1 (this file), dsh-lan.cmd (wrapper for
  cmd.exe / double-click), dsh-lan.sh (macOS / Linux). The flags below mirror the shell
  script one-for-one; see README.md for the mapping table.

  Default behaviour: start the GUI through the repository's own dsh-start.ps1 with
  --trusted-host <this machine's LAN address>, tee its stdout into a log file, then run
  lan-bridge.mjs in the foreground with --token-file pointing at that log. The bridge picks
  the launch token out of the GUI output, prints the ready-to-open LAN URL, and (with
  -AutoLogin) answers an unauthenticated page navigation with a 303 to /?token=..., so a
  phone never has to paste a token.

  Why a forwarder instead of --host 0.0.0.0: upstream refuses all-interfaces binding on
  purpose (it would expose remote code execution to the network) and the webserver row only
  accepts 127.0.0.1 | 0.0.0.0. So the GUI stays on loopback, the bridge listens on the LAN
  address, and --trusted-host lets the /api Host/Origin fence accept that authority.

  Ports: -Port 3081 is the GUI on loopback, -LanPort 3082 is this bridge on the LAN address,
  which makes the two processes easy to tell apart.

  Usage:
    .\dsh-lan.ps1                                          # GUI + forwarder (default)
    .\dsh-lan.ps1 -AutoLogin -Allow 10.228.0.0/16           # phone opens the bare URL
    .\dsh-lan.ps1 -AutoLogin -Allow 10.228.8.25,10.224.50.9
    .\dsh-lan.ps1 -GuiOnly                                  # GUI only
    .\dsh-lan.ps1 -BridgeOnly -RewriteHost                   # forwarder only (GUI already up)
    .\dsh-lan.ps1 -BridgeOnly -Token "<token or URL>" -AutoLogin -Allow 10.228.0.0/16
    .\dsh-lan.ps1 -LanPort 3092 -Port 8080
    .\dsh-lan.ps1 -Repository D:\dsh -LanIp 10.224.50.116
    .\dsh-lan.ps1 -PrintOnly                                 # print the commands, run nothing

  Note: this file is deliberately pure ASCII. Windows PowerShell 5.1 reads a BOM-less script
  with the OEM code page, so non-ASCII text here can break parsing.
#>
# PositionalBinding off: otherwise a stray token like --help would be swallowed by the
# first positional parameter (-Repository) and the script would derail instead of helping.
[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Repository,
  [string]$LanIp,
  [int]$Port = 3081,
  [int]$LanPort = 3082,
  [switch]$AutoLogin,
  [string]$Allow,
  [switch]$AnySource,
  [switch]$BridgeOnly,
  [switch]$RewriteHost,
  [string]$Token,
  [string]$TokenFile,
  [switch]$GuiOnly,
  [switch]$PrintOnly,
  [Alias('h')][switch]$Help,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Extra
)

$ErrorActionPreference = 'Stop'

function Show-Usage {
  $lines = @(
    'dsh-lan.ps1 - DSH Web GUI + LAN forwarder (same tool as dsh-lan.cmd and dsh-lan.sh)',
    '',
    'Modes:',
    '  (no flags)              start the GUI (dsh-start.ps1 + --trusted-host) and the forwarder',
    '  -GuiOnly                only the GUI',
    '  -BridgeOnly             only the forwarder (the GUI must already be running)',
    '  -RewriteHost            forwarder rewrites Host/Origin, for a GUI started WITHOUT',
    '                          --trusted-host (dsh-lan.sh calls this --rewrite-host)',
    '',
    'Already running a GUI?',
    '  If something already answers on -Port, this launcher forwards to it instead of',
    '  starting a second GUI, tells you whether -RewriteHost is required, and reminds you',
    '  that its launch token is unknown unless you pass -Token / -TokenFile.',
    '',
    'Token / login (so a phone never pastes a token):',
    '  -AutoLogin              answer an unauthenticated page navigation with a 303 to the',
    '                          token URL; needs -Allow or -AnySource',
    '  -Allow <ip[,ip|cidr]>   forwarder source allowlist, e.g. 10.228.0.0/16',
    '  -AnySource              explicitly accept every source (prints a loud warning)',
    '  -Token <token|URL>      pass the GUI launch token (a URL containing ?token= works)',
    '  -TokenFile <path>       read the token from a file (the GUI log)',
    '',
    'Ports / paths:',
    '  -Port <n>               GUI port on loopback (default 3081)',
    '  -LanPort <n>            LAN listener port (default 3082)',
    '  -LanIp <address>        bind/advertise this LAN address (default: first non-internal IPv4)',
    '  -Repository <path>      DSH checkout; remembered in dsh-lan.repo, else auto-detected',
    '',
    'Misc:',
    '  -PrintOnly              print the commands and exit',
    '  -h | -Help              this text (-? prints the parameter list too)',
    '',
    'Examples:',
    '  dsh-lan.cmd -AutoLogin -Allow 10.228.0.0/16      phone opens the bare URL, no token',
    '  dsh-lan.cmd -GuiOnly',
    '  dsh-lan.cmd -BridgeOnly -RewriteHost            GUI already running elsewhere',
    '  dsh-lan.cmd -BridgeOnly -Token "<token or URL>" -AutoLogin -Allow 10.228.0.0/16',
    '  dsh-lan.cmd -LanPort 3092 -Port 8080',
    '  dsh-lan.cmd -PrintOnly                          show the exact commands'
  )
  $lines | ForEach-Object { Write-Host $_ }
}

$helpTokens = @('--help', '-help', '-h', '/?', '/help', 'help', '-?')
if ($Help) { Show-Usage; exit 0 }
if ($Extra) {
  foreach ($item in $Extra) {
    if ($helpTokens -contains $item.ToLower()) { Show-Usage; exit 0 }
  }
  throw ('Unknown argument(s): ' + ($Extra -join ' ') + ' - run dsh-lan.ps1 -Help (or dsh-lan.cmd -h)')
}

function Find-DshRepository {
  param([string]$Start)
  $dir = $Start
  for ($i = 0; $i -lt 6; $i++) {
    if (Test-Path (Join-Path $dir 'apps\cli\lib\bin.js')) { return $dir }
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  return $null
}

if ($GuiOnly -and ($BridgeOnly -or $RewriteHost)) {
  throw '-GuiOnly cannot be combined with -BridgeOnly or -RewriteHost.'
}
if ($AutoLogin -and -not $Allow -and -not $AnySource) {
  throw 'AutoLogin would hand a DSH session to every source that can reach the port. Pass -Allow <ip[,ip|cidr]> (or -AnySource to accept that on purpose).'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node not found on PATH; install Node.js first.' }
if (-not (Get-Command powershell -ErrorAction SilentlyContinue)) { throw 'powershell not found on PATH.' }

# Where is the checkout? -Repository wins, then DSH_REPO, then the path this script saved
# last time (dsh-lan.repo, valid only while it really holds apps\cli\lib\bin.js), then the
# parent of DSH_HOME, then a walk up from this script. The resolved path is remembered so
# you only pass -Repository once.
$repoFile = Join-Path $PSScriptRoot 'dsh-lan.repo'
if (-not $Repository -and $env:DSH_REPO) { $Repository = $env:DSH_REPO }
if (-not $Repository -and (Test-Path $repoFile)) {
  $saved = (Get-Content $repoFile -TotalCount 1).Trim()
  if ($saved -and (Test-Path (Join-Path $saved 'apps\cli\lib\bin.js'))) { $Repository = $saved }
}
if (-not $Repository -and $env:DSH_HOME) {
  $candidate = Split-Path -Parent $env:DSH_HOME
  if ($candidate -and (Test-Path (Join-Path $candidate 'apps\cli\lib\bin.js'))) { $Repository = $candidate }
}
if (-not $Repository) { $Repository = Find-DshRepository -Start $PSScriptRoot }
if (-not $Repository) {
  throw 'Cannot find the DSH repository root (it must contain apps\cli\lib\bin.js). Pass -Repository <path> once; dsh-lan.repo remembers it.'
}
try { Set-Content -Path $repoFile -Value $Repository -NoNewline -ErrorAction Stop } catch { }
if (-not (Test-Path (Join-Path $Repository 'apps\cli\lib\bin.js'))) {
  throw ('No apps\cli\lib\bin.js under ' + $Repository + '; run pnpm install and pnpm build there first.')
}

$bridge = Join-Path (Join-Path $PSScriptRoot 'scripts') 'lan-bridge.mjs'
if (-not (Test-Path $bridge)) { throw ('Missing ' + $bridge + '; it must live in the scripts subdirectory next to this script.') }

if (-not $LanIp) {
  # lan-bridge.mjs owns address detection: PowerShell 5.1 strips embedded double quotes when
  # it passes an argument to a native exe, so a node -e one-liner here would be mangled.
  $LanIp = (& node $bridge --print-lan-ip | Out-String).Trim()
}
if (-not $LanIp) { throw 'No LAN IPv4 address found; pass -LanIp <address>.' }

$launcher = Join-Path $Repository 'dsh-start.ps1'
$useLauncher = Test-Path $launcher
$guiArgList = @('web', '--no-open', '--port', $Port, '--trusted-host', $LanIp)
if ($useLauncher) {
  $guiFile = 'powershell'
  $guiArgList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher) + $guiArgList
} else {
  $guiFile = 'node'
  $guiArgList = @((Join-Path $Repository 'apps\cli\lib\bin.js')) + $guiArgList
}

$logDir = Join-Path $env:TEMP ('dsh-lan-' + ([guid]::NewGuid().ToString('N').Substring(0, 8)))
$guiLog = Join-Path $logDir 'gui.log'
$guiErr = Join-Path $logDir 'gui.err'

function Test-LoopbackPort {
  param([int]$P, [int]$TimeoutMs = 400)
  $client = New-Object System.Net.Sockets.TcpClient
  try { return $client.ConnectAsync('127.0.0.1', $P).Wait($TimeoutMs) }
  catch { return $false }
  finally { $client.Close() }
}

# 'DSH is already running' is the normal case: never start a second GUI onto the same
# port - forward to the one that is already listening instead. This must run BEFORE the
# bridge arguments are assembled, because it flips the mode.
if (-not $GuiOnly -and -not $BridgeOnly -and -not $RewriteHost) {
  if (Test-LoopbackPort -P $Port) {
    $BridgeOnly = $true
    Write-Host ('dsh-lan: a GUI already answers on 127.0.0.1:' + $Port + ' - not starting a second one (bridge only)')
  }
}
$bridgeArgs = @($bridge, '--lan-port', $LanPort, '--target', ('127.0.0.1:' + $Port))
if ($RewriteHost) { $bridgeArgs += '--rewrite-host' }
if ($Token) {
  $bridgeArgs += @('--token', $Token)
} elseif ($TokenFile) {
  $bridgeArgs += @('--token-file', $TokenFile, '--echo-log')
} elseif (-not $BridgeOnly -and -not $RewriteHost) {
  $bridgeArgs += @('--token-file', $guiLog, '--echo-log')
}
if ($Allow) { $bridgeArgs += @('--allow', $Allow) }
if ($AutoLogin) { $bridgeArgs += '--auto-login' }
if ($AnySource) { $bridgeArgs += '--any-source' }


$mode = 'gui+bridge'
if ($GuiOnly) { $mode = 'gui only' }
elseif ($BridgeOnly -or $RewriteHost) { $mode = 'bridge only' }

if ($mode -eq 'bridge only') {
  if (-not $RewriteHost) {
    $trust = (& node $bridge --probe-trust ($LanIp + ':' + $LanPort) --target ('127.0.0.1:' + $Port) | Out-String).Trim()
    if ($trust -eq 'untrusted') {
      Write-Warning ('the GUI on 127.0.0.1:' + $Port + ' does not trust ' + $LanIp + ' yet, so /api would answer 403. Add -RewriteHost, or restart the GUI through this launcher (it passes --trusted-host).')
    } elseif ($trust -eq 'unreachable') {
      Write-Warning ('nothing is listening on 127.0.0.1:' + $Port + ' - start the GUI first, or drop -BridgeOnly.')
    }
  }
  if (-not $Token -and -not $TokenFile) {
    Write-Host 'dsh-lan: tip: this launcher did not start the GUI, so its launch token is unknown.'
    Write-Host 'dsh-lan:      Pass -Token "<token or URL>" plus -AutoLogin -Allow <source> so a phone skips the token.'
  }
}

Write-Host ('dsh-lan: mode      = ' + $mode)
Write-Host ('dsh-lan: repo      = ' + $Repository)
Write-Host ('dsh-lan: lan ip    = ' + $LanIp)
Write-Host ('dsh-lan: gui port  = ' + $Port + '  (loopback)' + $(if ($GuiOnly -or $mode -eq 'gui+bridge') { '' } else { '  [not started]' }))
Write-Host ('dsh-lan: lan port  = ' + $LanPort + '  (LAN listener)')
Write-Host ('dsh-lan: DSH_HOME  = ' + (Join-Path $Repository '.dsh_home'))
if ($useLauncher) { Write-Host ('dsh-lan: launcher  = ' + $launcher) }
else { Write-Host 'dsh-lan: launcher  = dsh-start.ps1 not found; calling node apps\cli\lib\bin.js directly' }
if ($mode -ne 'gui only') { Write-Host ('dsh-lan: LAN entry = http://' + $LanIp + ':' + $LanPort + '/') }
if ($AutoLogin) {
  if ($AnySource) { Write-Host 'dsh-lan: auto-login  = ON for ANY source (-AnySource)' }
  else { Write-Host ('dsh-lan: auto-login  = ON for ' + $Allow) }
} elseif ($mode -ne 'gui only') {
  Write-Host 'dsh-lan: auto-login  = off (the bridge prints a URL that already carries the token)'
}
if ($mode -eq 'gui+bridge') { Write-Host ('dsh-lan: gui log    = ' + $guiLog) }

if ($PrintOnly) {
  Write-Host ''
  Write-Host 'will run (cwd = repository root):'
  if ($GuiOnly -or $mode -eq 'gui+bridge') {
    Write-Host ('  ' + $guiFile + ' ' + (($guiArgList | ForEach-Object { '"' + $_ + '"' }) -join ' '))
  }
  if ($mode -ne 'gui only') {
    Write-Host ('  node ' + (($bridgeArgs | ForEach-Object { '"' + $_ + '"' }) -join ' '))
  }
  exit 0
}

Push-Location $Repository
try {
  if ($GuiOnly) {
    Write-Host 'dsh-lan: starting the GUI only; add no flags to also run the forwarder.'
    & $guiFile @guiArgList
    exit 0
  }

  New-Item -ItemType Directory -Force -Path $logDir | Out-Null

  if ($mode -eq 'gui+bridge') {
    $gui = Start-Process -FilePath $guiFile -ArgumentList $guiArgList -WorkingDirectory $Repository -NoNewWindow -PassThru -RedirectStandardOutput $guiLog -RedirectStandardError $guiErr
    try {
      $deadline = (Get-Date).AddSeconds(90)
      $ready = $false
      while (-not $ready -and (Get-Date) -lt $deadline) {
        if ($gui.HasExited) { break }
        $probe = New-Object System.Net.Sockets.TcpClient
        try { if ($probe.ConnectAsync('127.0.0.1', $Port).Wait(500)) { $ready = $true } }
        catch { }
        finally { $probe.Close() }
        if (-not $ready) { Start-Sleep -Milliseconds 300 }
      }
      if (-not $ready) { Write-Warning 'dsh-lan: the GUI did not open its loopback port in time; starting the bridge anyway.' }
      if ($gui.HasExited) {
        Write-Warning ('dsh-lan: the GUI process exited (code ' + $gui.ExitCode + '). If another GUI already listens on 127.0.0.1:' + $Port + ', keep that one and run this instead: dsh-lan.cmd -BridgeOnly [-RewriteHost]')
      }
      Write-Host ('dsh-lan: GUI ready on 127.0.0.1:' + $Port + ' - starting the forwarder (Ctrl+C stops both)')
      & node @bridgeArgs
    } finally {
      if ($gui -and -not $gui.HasExited) { Stop-Process -Id $gui.Id -Force }
    }
  } else {
    Write-Host 'dsh-lan: starting the forwarder only (the GUI must already be running)'
    & node @bridgeArgs
  }
} finally {
  Pop-Location
}
