$ErrorActionPreference = 'Stop'

$projectRef = 'biyzmqfpxeqkittmnxpu'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot 'supabase\.env.meta.local'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Crie supabase/.env.meta.local a partir de supabase/.env.example.'
}

$settings = @{}
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $settings[$matches[1]] = $matches[2].Trim()
  }
}

$requiredKeys = @('META_ADS_WORKER_SECRET', 'META_ACCESS_TOKEN_1', 'META_ACCESS_TOKEN_2')
foreach ($key in $requiredKeys) {
  if (-not $settings.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($settings[$key])) {
    throw "Preencha $key em supabase/.env.meta.local."
  }
}

if ($settings['META_ADS_WORKER_SECRET'].Length -lt 32) {
  throw 'META_ADS_WORKER_SECRET deve ter pelo menos 32 caracteres.'
}

Push-Location $projectRoot
try {
  npx supabase secrets set --env-file $envFile --project-ref $projectRef
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao cadastrar os secrets no Supabase.' }

  npx supabase functions deploy meta-ads-sync --project-ref $projectRef
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao publicar a função meta-ads-sync.' }

  $headers = @{ 'x-worker-secret' = $settings['META_ADS_WORKER_SECRET'] }
  $endpoint = "https://$projectRef.supabase.co/functions/v1/meta-ads-sync"

  $firstSync = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers `
    -ContentType 'application/json' -Body '{"mode":"sync"}'
  $firstSync | ConvertTo-Json -Depth 10

  $schedule = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers `
    -ContentType 'application/json' -Body '{"mode":"configure"}'
  $schedule | ConvertTo-Json -Depth 10
} finally {
  Pop-Location
}
