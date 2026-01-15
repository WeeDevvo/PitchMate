# PowerShell script to set up the PitchMate database
# This script applies EF Core migrations and seeds initial data

param(
    [string]$ConnectionString = "",
    [switch]$SeedOnly = $false,
    [switch]$Help = $false
)

function Show-Help {
    Write-Host "PitchMate Database Setup Script" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  .\setup-database.ps1 [-ConnectionString <string>] [-SeedOnly] [-Help]"
    Write-Host ""
    Write-Host "Parameters:" -ForegroundColor Yellow
    Write-Host "  -ConnectionString  Optional. Database connection string. If not provided, uses appsettings.json"
    Write-Host "  -SeedOnly          Optional. Only seed data, skip migrations"
    Write-Host "  -Help              Show this help message"
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Yellow
    Write-Host "  .\setup-database.ps1"
    Write-Host "  .\setup-database.ps1 -SeedOnly"
    Write-Host "  .\setup-database.ps1 -ConnectionString 'Host=localhost;Database=pitchmate;...'"
    Write-Host ""
}

if ($Help) {
    Show-Help
    exit 0
}

Write-Host "=== PitchMate Database Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the solution root
if (-not (Test-Path "PitchMate.sln")) {
    Write-Host "Error: This script must be run from the solution root directory" -ForegroundColor Red
    exit 1
}

# Check if dotnet ef is installed
$efInstalled = dotnet tool list --global | Select-String "dotnet-ef"
if (-not $efInstalled) {
    Write-Host "Warning: dotnet-ef tool is not installed globally" -ForegroundColor Yellow
    Write-Host "Installing dotnet-ef..." -ForegroundColor Yellow
    dotnet tool install --global dotnet-ef
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to install dotnet-ef tool" -ForegroundColor Red
        exit 1
    }
}

# Set connection string environment variable if provided
if ($ConnectionString) {
    Write-Host "Using provided connection string" -ForegroundColor Green
    $env:ConnectionStrings__DefaultConnection = $ConnectionString
}

# Apply migrations (unless SeedOnly is specified)
if (-not $SeedOnly) {
    Write-Host "Step 1: Applying EF Core migrations..." -ForegroundColor Yellow
    dotnet ef database update --project src/PitchMate.Infrastructure --startup-project src/PitchMate.API --verbose
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to apply migrations" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Migrations applied successfully!" -ForegroundColor Green
    Write-Host ""
}

# Seed initial data
Write-Host "Step 2: Seeding initial configuration data..." -ForegroundColor Yellow
dotnet run --project src/PitchMate.API -- --seed

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to seed database" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Database Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Configure Google OAuth credentials (see GOOGLE_OAUTH_SETUP.md)"
Write-Host "2. Run the application: dotnet run --project src/PitchMate.API"
Write-Host "3. Access Swagger UI at: https://localhost:7xxx/swagger"
Write-Host ""
