# Redis HR Lab — tek komutla kendi GitHub repository'nize yayınlama.
# Gereken: Git for Windows ve GitHub'a HTTPS üzerinden giriş.
# Kullanım: PowerShell'de proje klasöründen .\publish-to-github.ps1
param(
    [string]$Repository = "https://github.com/Emocancell/Redis-DotNet-Lab.git"
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git kurulu değil. Önce https://git-scm.com/downloads adresinden Git for Windows kurun."
}
$destination = Join-Path ([IO.Path]::GetTempPath()) ("RedisHRLab-publish-" + [guid]::NewGuid().ToString("N"))
Write-Host "GitHub repository klonlanıyor: $Repository"
& git clone --depth 1 $Repository $destination
if ($LASTEXITCODE -ne 0) { throw "Repository klonlanamadı. GitHub oturumunu kontrol edin." }
try {
    Get-ChildItem -LiteralPath $PSScriptRoot -Force |
        Where-Object { $_.Name -notin @('.git', '__pycache__') -and $_.Extension -ne '.zip' } |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
        }
    Push-Location $destination
    try {
        & git add -A
        & git diff --cached --quiet
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Repository zaten güncel."
            return
        }
        & git commit -m "feat: add Redis HR Analytics with .NET, PostgreSQL and Redis"
        if ($LASTEXITCODE -ne 0) { throw "Commit başarısız. Git user.name / user.email ayarlarını kontrol edin." }
        & git push origin HEAD:main
        if ($LASTEXITCODE -ne 0) { throw "Push başarısız. GitHub oturumunu ve repository yazma erişimini kontrol edin." }
        Write-Host "BAŞARILI: $Repository"
    }
    finally { Pop-Location }
}
finally {
    if (Test-Path $destination) { Remove-Item -Recurse -Force $destination }
}
