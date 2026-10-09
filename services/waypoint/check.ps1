$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Push-Location backend
try {
    & '..\.venv\Scripts\python.exe' -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    & '..\.venv\Scripts\python.exe' -m ruff check app tests
    if ($LASTEXITCODE -ne 0) { throw 'Python lint failed.' }
    & '..\.venv\Scripts\python.exe' -m mypy app
    if ($LASTEXITCODE -ne 0) { throw 'Python type check failed.' }
} finally { Pop-Location }
Push-Location (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
try {
    npm.cmd run lint
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript check failed.' }
    npm.cmd test -- tests/waypoint
    if ($LASTEXITCODE -ne 0) { throw 'Site integration tests failed.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
} finally { Pop-Location }
