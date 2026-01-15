# PowerShell script to run automated end-to-end tests for PitchMate
# This script tests the complete user flow from registration to match completion

param(
    [string]$ApiUrl = "https://localhost:7000",
    [switch]$SkipBuild = $false,
    [switch]$Verbose = $false,
    [switch]$Help = $false
)

function Show-Help {
    Write-Host "PitchMate End-to-End Test Script" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  .\run-e2e-tests.ps1 [-ApiUrl <string>] [-SkipBuild] [-Verbose] [-Help]"
    Write-Host ""
    Write-Host "Parameters:" -ForegroundColor Yellow
    Write-Host "  -ApiUrl      Optional. API base URL (default: https://localhost:7000)"
    Write-Host "  -SkipBuild   Optional. Skip building the project"
    Write-Host "  -Verbose     Optional. Show detailed output"
    Write-Host "  -Help        Show this help message"
    Write-Host ""
}

if ($Help) {
    Show-Help
    exit 0
}

# Test results tracking
$script:TestsPassed = 0
$script:TestsFailed = 0
$script:TestResults = @()

function Write-TestHeader {
    param([string]$Message)
    Write-Host ""
    Write-Host "=== $Message ===" -ForegroundColor Cyan
    Write-Host ""
}

function Write-TestStep {
    param([string]$Message)
    Write-Host "  → $Message" -ForegroundColor Yellow
}

function Write-TestSuccess {
    param([string]$Message)
    Write-Host "  ✓ $Message" -ForegroundColor Green
    $script:TestsPassed++
    $script:TestResults += @{ Status = "PASS"; Message = $Message }
}

function Write-TestFailure {
    param([string]$Message, [string]$Details = "")
    Write-Host "  ✗ $Message" -ForegroundColor Red
    if ($Details) {
        Write-Host "    Details: $Details" -ForegroundColor Red
    }
    $script:TestsFailed++
    $script:TestResults += @{ Status = "FAIL"; Message = $Message; Details = $Details }
}

function Invoke-ApiRequest {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body = $null,
        [string]$Token = $null
    )
    
    $uri = "$ApiUrl$Endpoint"
    $headers = @{
        "Content-Type" = "application/json"
    }
    
    if ($Token) {
        $headers["Authorization"] = "Bearer $Token"
    }
    
    try {
        $params = @{
            Uri = $uri
            Method = $Method
            Headers = $headers
            SkipCertificateCheck = $true
        }
        
        if ($Body) {
            $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
        }
        
        if ($Verbose) {
            Write-Host "    Request: $Method $uri" -ForegroundColor DarkGray
            if ($Body) {
                Write-Host "    Body: $($params["Body"])" -ForegroundColor DarkGray
            }
        }
        
        $response = Invoke-RestMethod @params
        
        if ($Verbose) {
            Write-Host "    Response: $($response | ConvertTo-Json -Depth 5)" -ForegroundColor DarkGray
        }
        
        return @{ Success = $true; Data = $response }
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $errorMessage = $_.Exception.Message
        
        if ($Verbose) {
            Write-Host "    Error: $errorMessage" -ForegroundColor DarkGray
        }
        
        return @{ Success = $false; StatusCode = $statusCode; Error = $errorMessage }
    }
}

# Check if we're in the solution root
if (-not (Test-Path "PitchMate.sln")) {
    Write-Host "Error: This script must be run from the solution root directory" -ForegroundColor Red
    exit 1
}

Write-Host "=== PitchMate End-to-End Tests ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "API URL: $ApiUrl" -ForegroundColor White
Write-Host ""

# Build the project (unless skipped)
if (-not $SkipBuild) {
    Write-TestHeader "Building Project"
    Write-TestStep "Building solution..."
    dotnet build --configuration Release > $null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-TestSuccess "Project built successfully"
    } else {
        Write-TestFailure "Failed to build project"
        exit 1
    }
}

# Generate unique test data
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$testEmail1 = "test1_$timestamp@example.com"
$testEmail2 = "test2_$timestamp@example.com"
$testPassword = "SecurePassword123!"
$squadName = "Test Squad $timestamp"

# Store tokens and IDs
$token1 = $null
$token2 = $null
$userId1 = $null
$userId2 = $null
$squadId = $null
$matchId = $null

# Test Scenario 1: User Registration and Authentication
Write-TestHeader "Test Scenario 1: User Registration and Authentication"

Write-TestStep "Registering user 1..."
$result = Invoke-ApiRequest -Method POST -Endpoint "/api/auth/register" -Body @{
    email = $testEmail1
    password = $testPassword
}
if ($result.Success -and $result.Data.token) {
    $token1 = $result.Data.token
    $userId1 = $result.Data.userId
    Write-TestSuccess "User 1 registered successfully"
} else {
    Write-TestFailure "Failed to register user 1" -Details $result.Error
}

Write-TestStep "Attempting duplicate registration..."
$result = Invoke-ApiRequest -Method POST -Endpoint "/api/auth/register" -Body @{
    email = $testEmail1
    password = $testPassword
}
if (-not $result.Success -and $result.StatusCode -eq 400) {
    Write-TestSuccess "Duplicate registration correctly rejected"
} else {
    Write-TestFailure "Duplicate registration should have been rejected"
}

Write-TestStep "Logging in with valid credentials..."
$result = Invoke-ApiRequest -Method POST -Endpoint "/api/auth/login" -Body @{
    email = $testEmail1
    password = $testPassword
}
if ($result.Success -and $result.Data.token) {
    Write-TestSuccess "Login successful with valid credentials"
} else {
    Write-TestFailure "Failed to login with valid credentials" -Details $result.Error
}

Write-TestStep "Attempting login with invalid credentials..."
$result = Invoke-ApiRequest -Method POST -Endpoint "/api/auth/login" -Body @{
    email = $testEmail1
    password = "WrongPassword"
}
if (-not $result.Success -and $result.StatusCode -eq 401) {
    Write-TestSuccess "Invalid credentials correctly rejected"
} else {
    Write-TestFailure "Invalid credentials should have been rejected"
}

# Test Scenario 2: Squad Creation and Management
Write-TestHeader "Test Scenario 2: Squad Creation and Management"

Write-TestStep "Creating a squad..."
$result = Invoke-ApiRequest -Method POST -Endpoint "/api/squads" -Token $token1 -Body @{
    name = $squadName
}
if ($result.Success -and $result.Data.id) {
    $squadId = $result.Data.id
    Write-TestSuccess "Squad created successfully"
} else {
    Write-TestFailure "Failed to create squad" -Details $result.Error
}

Write-TestStep "Getting user's squads..."
$result = Invoke-ApiRequest -Method GET -Endpoint "/api/squads" -Token $token1
if ($result.Success -and $result.Data.Count -gt 0) {
    Write-TestSuccess "Retrieved user's squads"
} else {
    Write-TestFailure "Failed to retrieve user's squads" -Details $result.Error
}

Write-TestStep "Registering user 2..."
$result = Invoke-ApiRequest -Method POST -Endpoint "/api/auth/register" -Body @{
    email = $testEmail2
    password = $testPassword
}
if ($result.Success -and $result.Data.token) {
    $token2 = $result.Data.token
    $userId2 = $result.Data.userId
    Write-TestSuccess "User 2 registered successfully"
} else {
    Write-TestFailure "Failed to register user 2" -Details $result.Error
}

if ($squadId) {
    Write-TestStep "User 2 joining squad..."
    $result = Invoke-ApiRequest -Method POST -Endpoint "/api/squads/$squadId/join" -Token $token2
    if ($result.Success) {
        Write-TestSuccess "User 2 joined squad"
    } else {
        Write-TestFailure "Failed to join squad" -Details $result.Error
    }
    
    Write-TestStep "Verifying user 2's initial rating..."
    $result = Invoke-ApiRequest -Method GET -Endpoint "/api/users/$userId2/squads/$squadId/rating" -Token $token2
    if ($result.Success -and $result.Data.rating -eq 1000) {
        Write-TestSuccess "User 2 has correct initial rating (1000)"
    } else {
        Write-TestFailure "User 2 rating is incorrect" -Details "Expected 1000, got $($result.Data.rating)"
    }
}

# Test Scenario 3: Match Creation
Write-TestHeader "Test Scenario 3: Match Creation"

if ($squadId -and $userId1 -and $userId2) {
    # For a real test, we'd need more players. For now, we'll test with 2 players
    Write-TestStep "Creating a match with 2 players..."
    $scheduledAt = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
    $result = Invoke-ApiRequest -Method POST -Endpoint "/api/squads/$squadId/matches" -Token $token1 -Body @{
        scheduledAt = $scheduledAt
        playerIds = @($userId1, $userId2)
        teamSize = 1
    }
    if ($result.Success -and $result.Data.id) {
        $matchId = $result.Data.id
        Write-TestSuccess "Match created successfully"
    } else {
        Write-TestFailure "Failed to create match" -Details $result.Error
    }
    
    Write-TestStep "Attempting to create match with odd number of players..."
    $result = Invoke-ApiRequest -Method POST -Endpoint "/api/squads/$squadId/matches" -Token $token1 -Body @{
        scheduledAt = $scheduledAt
        playerIds = @($userId1)
        teamSize = 1
    }
    if (-not $result.Success -and $result.StatusCode -eq 400) {
        Write-TestSuccess "Odd player count correctly rejected"
    } else {
        Write-TestFailure "Odd player count should have been rejected"
    }
    
    Write-TestStep "Attempting to create match as non-admin..."
    $result = Invoke-ApiRequest -Method POST -Endpoint "/api/squads/$squadId/matches" -Token $token2 -Body @{
        scheduledAt = $scheduledAt
        playerIds = @($userId1, $userId2)
        teamSize = 1
    }
    if (-not $result.Success -and $result.StatusCode -eq 403) {
        Write-TestSuccess "Non-admin correctly forbidden from creating match"
    } else {
        Write-TestFailure "Non-admin should have been forbidden"
    }
}

# Test Scenario 4: Match Result and ELO Updates
Write-TestHeader "Test Scenario 4: Match Result and ELO Updates"

if ($matchId) {
    Write-TestStep "Recording match result..."
    $result = Invoke-ApiRequest -Method POST -Endpoint "/api/matches/$matchId/result" -Token $token1 -Body @{
        winner = "TeamA"
        balanceFeedback = "Test match"
    }
    if ($result.Success) {
        Write-TestSuccess "Match result recorded successfully"
    } else {
        Write-TestFailure "Failed to record match result" -Details $result.Error
    }
    
    Write-TestStep "Verifying match status updated..."
    $result = Invoke-ApiRequest -Method GET -Endpoint "/api/matches/$matchId" -Token $token1
    if ($result.Success -and $result.Data.status -eq "Completed") {
        Write-TestSuccess "Match status updated to Completed"
    } else {
        Write-TestFailure "Match status not updated correctly"
    }
    
    Write-TestStep "Attempting to record result again..."
    $result = Invoke-ApiRequest -Method POST -Endpoint "/api/matches/$matchId/result" -Token $token1 -Body @{
        winner = "TeamB"
    }
    if (-not $result.Success -and $result.StatusCode -eq 400) {
        Write-TestSuccess "Duplicate result correctly rejected"
    } else {
        Write-TestFailure "Duplicate result should have been rejected"
    }
}

# Test Summary
Write-Host ""
Write-Host "=== Test Summary ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Total Tests: $($script:TestsPassed + $script:TestsFailed)" -ForegroundColor White
Write-Host "Passed: $script:TestsPassed" -ForegroundColor Green
Write-Host "Failed: $script:TestsFailed" -ForegroundColor Red
Write-Host ""

if ($script:TestsFailed -gt 0) {
    Write-Host "Failed Tests:" -ForegroundColor Red
    foreach ($result in $script:TestResults) {
        if ($result.Status -eq "FAIL") {
            Write-Host "  ✗ $($result.Message)" -ForegroundColor Red
            if ($result.Details) {
                Write-Host "    $($result.Details)" -ForegroundColor DarkRed
            }
        }
    }
    Write-Host ""
    exit 1
} else {
    Write-Host "All tests passed! ✓" -ForegroundColor Green
    Write-Host ""
    exit 0
}
