$cur_dir = $PSScriptRoot
$env:DSH_HOME = Join-Path $cur_dir .dsh_home

# 判断是否需要同步会话
if(-not (Test-Path -Path $env:DSH_HOME/sessions -PathType Container)) {
    if(Test-Path -Path ~/.dsh/sessions -PathType Container) {
        Start-Process powershell -Verb RunAs -ArgumentList "-NoExit", "-Command", "New-Item -ItemType SymbolicLink -Path '$($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath("$env:DSH_HOME/sessions"))' -Target '$($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath("~/.dsh/sessions"))'"
    }
}

if ($args.Count -eq 0) {
    node .\apps\cli\lib\bin.js web --no-open --port 3081
} else {
    node .\apps\cli\lib\bin.js @args
}
