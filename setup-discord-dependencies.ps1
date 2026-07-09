# Create Discord dependencies update script
<#$PSScriptRoot = "$PWD"
$ErrorActionPreference = "Stop"

# Step 1: Clean up old packages
Write-Host "Removing old Discord.js packages..." -ForegroundColor Red
npm uninstall @discordjs/voice @discordjs/opus 2>$null

# Step 2: Install updated packages
Write-Host "Installing updated Discord.js packages..." -ForegroundColor Green
npm install @discordjs/voice@^2.0.0 @discordjs/opus@^0.11.0 @discordjs/node-pre-gyp libsodium-wrappers@^0.12.0 discord.js@^14.21.1 --legacy-peer-deps

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Discord dependencies updated successfully!" -ForegroundColor Green
    Write-Host "The project is now compatible with current Node.js version." -ForegroundColor Green
    
    # Create run script
    $runScript = @'
@REM Discord Synth Bot Development Environment
@echo off

cd /d %~dp0
set NODE_ENV=development
echo Starting Discord Synth Bot Services...
echo ================================
echo Running all services...
echo This will start:
  - Discord bot (connects to Discord)
  - Web API server (REST endpoints)
  - WebSocket server (real-time sync)
  - Web UI (React application)
echo.
echo To run individual services:
echo   dev:bot    (Discord bot only)
echo   dev:web    (Web server only)
echo   dev:ui     (Web UI only)
echo.
echo Press any key to continue...
echo.
pause >nul
'@n    
    $runScript | Out-File -FilePath "%~dp0\RUN_SETUP.bat" -Encoding ASCII
    
    Write-Host "✅ Created RUN_SETUP.bat" -ForegroundColor Green
} else {
    Write-Host "❌ Update failed" -ForegroundColor Red
    exit 1
}