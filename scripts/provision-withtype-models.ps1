[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProfilePath,

    [string]$SettingsPath = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'app.typefree.windows.unofficial\settings.json'),

    [string]$AsrCredentialTarget = 'qwen-asr-api-key.app.typefree.windows.unofficial',
    [string]$TextCredentialTarget = 'text-model-api-key.app.typefree.windows.unofficial',

    [switch]$SkipCredentials,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

foreach ($target in @($AsrCredentialTarget, $TextCredentialTarget)) {
    if ([string]::IsNullOrWhiteSpace($target) -or $target.Contains("`r") -or $target.Contains("`n")) {
        throw 'Credential targets must be non-empty single-line strings.'
    }
}

function Require-String {
    param([object]$Object, [string]$Name, [switch]$AllowEmpty)
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property -or $property.Value -isnot [string]) {
        throw "Profile field '$Name' must be a string."
    }
    $value = $property.Value.Trim()
    if (-not $AllowEmpty -and [string]::IsNullOrWhiteSpace($value)) {
        throw "Profile field '$Name' cannot be empty."
    }
    if ($value.Contains("`r") -or $value.Contains("`n")) {
        throw "Profile field '$Name' cannot contain line breaks."
    }
    return $value
}

function Require-HttpEndpoint {
    param([string]$Value, [string]$Name)
    $uri = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @('http', 'https')) {
        throw "Profile field '$Name' must be an absolute HTTP or HTTPS URL."
    }
}

if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) {
    throw "Private profile not found: $ProfilePath"
}

try {
    $profile = Get-Content -Raw -Encoding UTF8 -LiteralPath $ProfilePath | ConvertFrom-Json
} catch {
    throw "Private profile is not valid JSON: $($_.Exception.Message)"
}

$asrEndpoint = Require-String $profile 'asrEndpoint'
$asrModel = Require-String $profile 'asrModel'
$textEndpoint = Require-String $profile 'textEndpoint'
$textModel = Require-String $profile 'textModel'
$textFastModel = Require-String $profile 'textFastModel' -AllowEmpty
$textFallbackModels = Require-String $profile 'textFallbackModels' -AllowEmpty
$textAuthMode = Require-String $profile 'textAuthMode'
$asrApiKey = Require-String $profile 'asrApiKey'
$textApiKey = Require-String $profile 'textApiKey'

Require-HttpEndpoint $asrEndpoint 'asrEndpoint'
Require-HttpEndpoint $textEndpoint 'textEndpoint'
if ($textAuthMode -notin @('bearer', 'none')) {
    throw "Profile field 'textAuthMode' must be 'bearer' or 'none'."
}

$timeoutProperty = $profile.PSObject.Properties['textTimeoutMs']
if ($null -eq $timeoutProperty) { throw "Profile field 'textTimeoutMs' is required." }
$textTimeoutMs = [int]$timeoutProperty.Value
if ($textTimeoutMs -lt 3000 -or $textTimeoutMs -gt 300000) {
    throw "Profile field 'textTimeoutMs' must be between 3000 and 300000."
}

$settings = [ordered]@{}
if (Test-Path -LiteralPath $SettingsPath -PathType Leaf) {
    try {
        $existing = Get-Content -Raw -Encoding UTF8 -LiteralPath $SettingsPath | ConvertFrom-Json
    } catch {
        throw "Existing WithType settings are not valid JSON: $($_.Exception.Message)"
    }
    foreach ($property in $existing.PSObject.Properties) {
        $settings[$property.Name] = $property.Value
    }
}

$settings['asrEndpoint'] = $asrEndpoint
$settings['asrModel'] = $asrModel
$settings['textEndpoint'] = $textEndpoint
$settings['textModel'] = $textModel
$settings['textFastModel'] = $textFastModel
$settings['textFallbackModels'] = $textFallbackModels
$settings['textTimeoutMs'] = $textTimeoutMs
$settings['textAuthMode'] = $textAuthMode

if ($DryRun) {
    Write-Host "Validated WithType profile for ASR model '$asrModel' and text model '$textModel'."
    exit 0
}

if (-not $SkipCredentials) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class WithTypeCredentialWriter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public UInt32 Flags;
        public UInt32 Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);

    public static void Write(string target, string userName, string secret)
    {
        byte[] bytes = Encoding.Unicode.GetBytes(secret);
        if (bytes.Length > 512) throw new ArgumentException("Credential is too long.");
        IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var credential = new CREDENTIAL {
                Type = 1,
                TargetName = target,
                Comment = "WithType model API key",
                CredentialBlobSize = (UInt32)bytes.Length,
                CredentialBlob = blob,
                Persist = 2,
                UserName = userName
            };
            if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            for (int index = 0; index < bytes.Length; index++) Marshal.WriteByte(blob, index, 0);
            Array.Clear(bytes, 0, bytes.Length);
            Marshal.FreeHGlobal(blob);
        }
    }
}
'@

    [WithTypeCredentialWriter]::Write($AsrCredentialTarget, 'qwen-asr-api-key', $asrApiKey)
    [WithTypeCredentialWriter]::Write($TextCredentialTarget, 'text-model-api-key', $textApiKey)
}

$directory = Split-Path -Parent $SettingsPath
if ([string]::IsNullOrWhiteSpace($directory)) { throw 'SettingsPath must include a directory.' }
[IO.Directory]::CreateDirectory($directory) | Out-Null
$temporary = Join-Path $directory ('.settings-' + [Guid]::NewGuid().ToString('N') + '.tmp')
try {
    $json = $settings | ConvertTo-Json -Depth 32
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $SettingsPath -Force
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}

$asrApiKey = $null
$textApiKey = $null
Write-Host "WithType model settings and credentials were configured for this Windows user."
