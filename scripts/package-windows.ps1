# MSVC CI 与 Windows GNU 本地构建共用：校验 x64 PE 文件，并生成可解压运行的包。
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ReleaseDir,
    [string]$OutputDir = (Join-Path $PSScriptRoot '../dist/windows')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-X64Pe([string]$Path, [bool]$IsDll) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing Windows binary: $Path" }
    $reader = [System.IO.BinaryReader]::new([System.IO.File]::OpenRead($Path))
    try {
        if ($reader.BaseStream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5A4D) { throw "Invalid DOS header: $Path" }
        $reader.BaseStream.Position = 60
        $peOffset = $reader.ReadUInt32()
        if ($peOffset -lt 64 -or $peOffset + 24 -gt $reader.BaseStream.Length) { throw "Invalid PE offset: $Path" }
        $reader.BaseStream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550 -or $reader.ReadUInt16() -ne 0x8664) { throw "Expected Windows x64 PE: $Path" }
        $reader.BaseStream.Position = $peOffset + 22
        $characteristics = $reader.ReadUInt16()
        if (($characteristics -band 0x0002) -eq 0 -or (($characteristics -band 0x2000) -ne 0) -ne $IsDll) {
            throw "Wrong executable / DLL type: $Path"
        }
    } finally { $reader.Dispose() }
}

$releasePath = (Resolve-Path -LiteralPath $ReleaseDir).Path
$exePath = Join-Path $releasePath 'withtype.exe'
$loaderPath = (Join-Path $PSScriptRoot '../src-tauri/WebView2Loader.dll')
Assert-X64Pe $exePath $false
Assert-X64Pe $loaderPath $true

$null = New-Item -ItemType Directory -Force -Path $OutputDir
$outputPath = (Resolve-Path -LiteralPath $OutputDir).Path
$stagingPath = Join-Path $outputPath 'withtype-windows-x64'
$null = New-Item -ItemType Directory -Force -Path $stagingPath
$exeDestination = Join-Path $stagingPath 'withtype.exe'
$loaderDestination = Join-Path $stagingPath 'WebView2Loader.dll'
Copy-Item -LiteralPath $exePath -Destination $exeDestination -Force
Copy-Item -LiteralPath $loaderPath -Destination $loaderDestination -Force

$noticeDestination = Join-Path $stagingPath 'THIRD_PARTY_NOTICES.md'
$licenseDestination = Join-Path $stagingPath 'Typefree-GPL-3.0.txt'
(Get-Content -LiteralPath (Join-Path $PSScriptRoot '../THIRD_PARTY_NOTICES.md') -Raw).Replace('LICENSES/Typefree-GPL-3.0.txt', 'Typefree-GPL-3.0.txt').Replace('public/fonts/OFL-NotoSansSC.txt', 'OFL-NotoSansSC.txt').Replace('public/fonts/COPYRIGHT-NotoSansSC.txt', 'COPYRIGHT-NotoSansSC.txt').Replace('public/fonts/manifest.json', 'font-manifest.json') | Set-Content -LiteralPath $noticeDestination -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../LICENSES/Typefree-GPL-3.0.txt') -Destination $licenseDestination -Force
$fontLicenseDestination = Join-Path $stagingPath 'OFL-NotoSansSC.txt'
$fontCopyrightDestination = Join-Path $stagingPath 'COPYRIGHT-NotoSansSC.txt'
$fontManifestDestination = Join-Path $stagingPath 'font-manifest.json'
$appearanceDestination = Join-Path $stagingPath 'appearance-baseline.json'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../public/fonts/OFL-NotoSansSC.txt') -Destination $fontLicenseDestination -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../public/fonts/COPYRIGHT-NotoSansSC.txt') -Destination $fontCopyrightDestination -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../public/fonts/manifest.json') -Destination $fontManifestDestination -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../dist/client/appearance-baseline.json') -Destination $appearanceDestination -Force

$readmePath = Join-Path $stagingPath 'README.txt' 
@'
WithType for Windows - x64 portable package

Extract the entire archive to a writable local folder. Keep withtype.exe and
WebView2Loader.dll together, then run withtype.exe.

Requires Microsoft Edge WebView2 Runtime. If it is unavailable, use the NSIS
installer instead, or install the Evergreen Runtime from Microsoft:
https://developer.microsoft.com/microsoft-edge/webview2/

Settings and learned vocabulary use the Windows user profile, not this folder.
This package does not bundle model weights or API credentials.

See THIRD_PARTY_NOTICES.md and Typefree-GPL-3.0.txt for source attribution and
license terms. Noto font attribution is in OFL-NotoSansSC.txt and
COPYRIGHT-NotoSansSC.txt; font-manifest.json contains its checksum.
appearance-baseline.json identifies this build's colour/font source baseline.
This development build has not been signed.
'@ | Set-Content -LiteralPath $readmePath -Encoding UTF8

$checksumPath = Join-Path $stagingPath 'SHA256SUMS.txt'
@($exeDestination, $loaderDestination) | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([System.IO.Path]::GetFileName($_))"
} | Set-Content -LiteralPath $checksumPath -Encoding ASCII

$archivePath = Join-Path $outputPath 'withtype-windows-x64-portable.zip'
$members = @($exeDestination, $loaderDestination, $readmePath, $checksumPath, $noticeDestination, $licenseDestination, $fontLicenseDestination, $fontCopyrightDestination, $fontManifestDestination, $appearanceDestination)
Compress-Archive -LiteralPath $members -DestinationPath $archivePath -Force

# 打开压缩包并校验成员内容，避免仅凭文件存在就认为便携包完整。
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($archive.Entries.Count -ne $members.Count) { throw 'Unexpected portable archive contents.' }
    foreach ($member in $members) {
        $entry = $archive.GetEntry([System.IO.Path]::GetFileName($member))
        if ($null -eq $entry -or $entry.Length -ne (Get-Item -LiteralPath $member).Length) {
            throw "Missing or truncated archive member: $member"
        }
        $stream = $entry.Open()
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $actual = [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')
            if ($actual -ne (Get-FileHash -LiteralPath $member -Algorithm SHA256).Hash) {
                throw "Archive checksum mismatch: $member"
            }
        } finally { $sha.Dispose(); $stream.Dispose() }
    }
} finally { $archive.Dispose() }

$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$archiveHash  $([System.IO.Path]::GetFileName($archivePath))" | Set-Content -LiteralPath "$archivePath.sha256" -Encoding ASCII
Write-Host "Verified Windows x64 portable package: $archivePath"
