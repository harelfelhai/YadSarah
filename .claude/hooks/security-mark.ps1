# PostToolUse hook — flags security-relevant edits for an end-of-turn security review.
# Reads the hook JSON from stdin, and if the edited file is security-sensitive,
# appends its path to .claude/.security-review-pending (consumed by security-stop.ps1).
$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw  = [Console]::In.ReadToEnd()
    $data = $raw | ConvertFrom-Json
    $path = $data.tool_input.file_path
} catch { exit 0 }

if ([string]::IsNullOrWhiteSpace($path)) { exit 0 }

$p = $path -replace '\\', '/'

# Security-relevant source areas (backend AuthN/Z, data, middleware, DTOs, entities; client auth/api/store)
$patterns = @(
    'src/Server/.*/(Controllers|Services|Middleware|Dtos|Entities)/',
    'src/Server/.*/Program\.cs',
    'src/Server/.*/AppDbContext\.cs',
    'src/Client/src/(api|store|realtime)/',
    'auth'
)

$hit = $false
foreach ($pat in $patterns) { if ($p -imatch $pat) { $hit = $true; break } }
if (-not $hit) { exit 0 }

$root   = Split-Path (Split-Path $PSScriptRoot)            # .claude/hooks -> .claude -> project root
$marker = Join-Path $root '.claude/.security-review-pending'
Add-Content -Path $marker -Value $path -Encoding UTF8
exit 0
