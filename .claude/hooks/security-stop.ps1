# Stop hook — if a security-relevant edit was made this turn, block the stop once and
# instruct Claude to run a security-compliance review and update the security docs.
# The marker is deleted on the first block to avoid an infinite loop.
$ErrorActionPreference = 'SilentlyContinue'

# Emit UTF-8 (no BOM) so the Hebrew reason reaches the harness intact.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

try { [Console]::In.ReadToEnd() | Out-Null } catch {}   # drain stdin (unused)

$root   = Split-Path (Split-Path $PSScriptRoot)
$marker = Join-Path $root '.claude/.security-review-pending'
if (-not (Test-Path $marker)) { exit 0 }                 # nothing pending -> allow stop

$files = (Get-Content $marker -Encoding UTF8 | Where-Object { $_ -ne '' } | Sort-Object -Unique) -join ', '
Remove-Item $marker -Force

# Read the Hebrew message from an external UTF-8 file (PowerShell 5.1 mis-decodes
# Hebrew literals embedded in the .ps1 itself; ReadAllText with explicit UTF-8 is safe).
$msgPath  = Join-Path $PSScriptRoot 'security-review-message.txt'
$template = [System.IO.File]::ReadAllText($msgPath, [System.Text.Encoding]::UTF8)
$reason   = $template.Replace('{FILES}', $files)

$json = @{ decision = 'block'; reason = $reason } | ConvertTo-Json -Compress

# Escape every non-ASCII char to \uXXXX so the JSON is pure ASCII and survives
# any console code page (Hebrew is restored by the harness when it parses the JSON).
$sb = New-Object System.Text.StringBuilder
foreach ($ch in $json.ToCharArray()) {
    $code = [int][char]$ch
    if ($code -gt 127) { [void]$sb.Append(('\u{0:x4}' -f $code)) }
    else { [void]$sb.Append($ch) }
}
[Console]::Out.Write($sb.ToString())
exit 0
