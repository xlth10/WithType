[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BaselineRoot,
    [Parameter(Mandatory = $true)][string]$OptimizedRoot,
    [Parameter(Mandatory = $true)][string]$Manifest,
    [Parameter(Mandatory = $true)][string]$AudioDir,
    [string]$OutputDir = (Join-Path $PSScriptRoot '../dist/verification/windows-processing'),
    [string]$SettingsPath = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'app.typefree.windows.unofficial\settings.json'),
    [string]$VocabularyPath = '',
    [string]$NativeBenchmarkExe = '',
    [switch]$RunChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

function Require-CommandSuccess([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Verification command failed. See the command output above.' }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Run this entry point on Windows. Service measurements are separate from desktop acceptance.'
}
$baseline = (Resolve-Path -LiteralPath $BaselineRoot).Path
$optimized = (Resolve-Path -LiteralPath $OptimizedRoot).Path
if ($baseline.TrimEnd('\') -ieq $optimized.TrimEnd('\')) {
    throw 'BaselineRoot and OptimizedRoot must be different checkouts.'
}
$manifestPath = (Resolve-Path -LiteralPath $Manifest).Path
$audioPath = (Resolve-Path -LiteralPath $AudioDir).Path
$settingsFile = (Resolve-Path -LiteralPath $SettingsPath).Path
$runner = Join-Path $optimized 'scripts/benchmark/run.mjs'
foreach ($required in @($runner)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw 'The optimized checkout is missing benchmark scripts.' }
}
$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
$shell = (Get-Process -Id $PID).Path
$settings = Get-Content -Raw -Encoding UTF8 -LiteralPath $settingsFile | ConvertFrom-Json

# Deliberately copy a whitelist. Never copy arbitrary profile fields, API keys,
# clipboard contents, editor contents, or private history into the report.
$safe = [ordered]@{ asrProvider = 'openai' }
$fields = @(
    'asrEndpoint', 'asrModel', 'textEndpoint', 'textModel', 'textFastModel',
    'textFallbackModels', 'textAuthMode', 'textTimeoutMs', 'processingMode',
    'vocabulary', 'textStreaming', 'textIncremental', 'autoIntent', 'autoLearn'
)
foreach ($field in $fields) {
    $property = $settings.PSObject.Properties[$field]
    if ($null -ne $property) { $safe[$field] = $property.Value }
}
foreach ($field in @('asrEndpoint', 'asrModel', 'textEndpoint', 'textModel')) {
    if (-not $safe.Contains($field) -or $safe[$field] -isnot [string] -or [string]::IsNullOrWhiteSpace($safe[$field])) {
        throw "Current Windows settings do not configure '$field'. Configure the existing model service before benchmarking."
    }
}
foreach ($field in @('asrEndpoint', 'textEndpoint')) {
    $uri = $null
    if (-not [Uri]::TryCreate($safe[$field], [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @('http', 'https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
        throw "'$field' must be a plain HTTP(S) service URL without embedded credentials or query parameters."
    }
}
if ([string]::IsNullOrWhiteSpace($VocabularyPath)) {
    $VocabularyPath = Join-Path (Split-Path -Parent $settingsFile) 'vocabulary.json'
}
if (Test-Path -LiteralPath $VocabularyPath -PathType Leaf) {
    if ((Get-Item -LiteralPath $VocabularyPath).Length -gt 1048576) { throw 'Vocabulary file exceeds the native 1 MiB limit.' }
    $vocabulary = Get-Content -Raw -Encoding UTF8 -LiteralPath $VocabularyPath | ConvertFrom-Json
    $entries = $vocabulary.PSObject.Properties['entries']
    if ($null -ne $entries) { $safe['learnedEntries'] = @($entries.Value) }
}
if ((Test-Path -LiteralPath $OutputDir) -and (Get-ChildItem -LiteralPath $OutputDir -Force | Select-Object -First 1)) {
    throw 'OutputDir must be new or empty, so an earlier comparison is not overwritten.'
}
$null = New-Item -ItemType Directory -Force -Path $OutputDir
$output = (Resolve-Path -LiteralPath $OutputDir).Path
$snapshot = Join-Path ([IO.Path]::GetTempPath()) ('withtype-benchmark-settings-' + [Guid]::NewGuid().ToString('N') + '.json')
$statusPath = Join-Path $output 'windows-validation.json'
$status = [ordered]@{
    schemaVersion = 1
    platform = 'windows'
    startedAt = [DateTime]::UtcNow.ToString('o')
    asrProvider = 'openai'
    asrModel = $safe['asrModel']
    textModel = $safe['textModel']
    nativeUnitChecks = 'not-requested'
    adapterTransport = 'native-rust-service-client'
    serviceBaseline = 'pending'
    serviceOptimized = 'pending'
    windowsClientRuntime = 'pending-manual-acceptance'
    microphoneCapture = 'pending-manual-acceptance'
    uiaAndPaste = 'pending-manual-acceptance'
    baselineRoot = $baseline
    optimizedRoot = $optimized
}
function Save-Status {
    [IO.File]::WriteAllText($statusPath, ($status | ConvertTo-Json -Depth 8), $utf8)
}
Save-Status
try {
    [IO.File]::WriteAllText($snapshot, ($safe | ConvertTo-Json -Depth 8), $utf8)
    if ($RunChecks) {
        Push-Location $optimized
        try {
            $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source
            Require-CommandSuccess $npm @('test')
            Require-CommandSuccess 'cargo' @('test', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'benchmark', '--lib')
            $status['nativeUnitChecks'] = 'passed-on-windows'
            Save-Status
        } finally { Pop-Location }
    }
    if ([string]::IsNullOrWhiteSpace($NativeBenchmarkExe)) {
        Push-Location $optimized
        try {
            Require-CommandSuccess 'cargo' @('build', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'benchmark', '--bin', 'pipeline-benchmark')
            $metadataJson = & cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --no-deps
            if ($LASTEXITCODE -ne 0) { throw 'Cannot locate the native benchmark build directory.' }
            $metadata = $metadataJson | ConvertFrom-Json
            $NativeBenchmarkExe = Join-Path $metadata.target_directory 'debug/pipeline-benchmark.exe'
        } finally { Pop-Location }
    }
    $nativeAdapter = (Resolve-Path -LiteralPath $NativeBenchmarkExe).Path
    $adapterCommand = ConvertTo-Json -InputObject @($nativeAdapter) -Compress
    foreach ($experiment in @(@{ label = 'baseline'; root = $baseline }, @{ label = 'optimized'; root = $optimized })) {
        $destination = Join-Path $output $experiment.label
        Require-CommandSuccess $node @(
            $runner, '--source-root', $experiment.root, '--settings', $snapshot,
            '--manifest', $manifestPath, '--audio-dir', $audioPath,
            '--output', $destination, '--label', $experiment.label,
            '--platform', 'windows', '--adapter-command', $adapterCommand
        )
        $statusKey = if ($experiment.label -eq 'baseline') { 'serviceBaseline' } else { 'serviceOptimized' }
        $status[$statusKey] = 'completed-see-results'
        Save-Status
    }
    $status['completedAt'] = [DateTime]::UtcNow.ToString('o')
    Save-Status
    Write-Host 'Service comparison completed. Microphone, shortcuts, UIA, paste, and installed-app behavior still require Windows desktop acceptance.'
    Write-Host "Reports: $output"
} catch {
    $status['runState'] = 'failed-see-safe-runner-output'
    Save-Status
    throw
} finally {
    if (Test-Path -LiteralPath $snapshot) { Remove-Item -LiteralPath $snapshot -Force }
}
