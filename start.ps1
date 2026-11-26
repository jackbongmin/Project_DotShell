# DotShell 개발용 실행 스크립트
# 엔진(Spring Boot)과 게임 창(Electron)을 한 번에 띄운다. start.bat을 더블클릭해서 실행하면 된다.
#
# 하는 일
#   1. JDK 21을 찾아 JAVA_HOME으로 지정 (JAVA_HOME, IntelliJ의 ~/.jdks, Program Files 순서)
#   2. Java 소켓 임시 폴더를 프로젝트의 .tmp로 지정 (일부 Windows에서 %TEMP% 소켓이 실패하는 문제 회피)
#   3. Docker가 꺼져 있으면 Docker Desktop을 켜고 기다림
#   4. 엔진이 안 떠 있으면 "DotShell 엔진" 창을 따로 열어 실행하고, 포트가 열릴 때까지 기다림
#   5. 클라이언트 패키지가 없으면 설치한 뒤 게임 창 실행

$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$Port = 8730

function Write-Step([string]$Message) {
    Write-Host "[DotShell] $Message" -ForegroundColor Yellow
}

function Exit-WithError([string]$Message) {
    Write-Host "[DotShell] $Message" -ForegroundColor Red
    exit 1
}

function Get-JdkMajor([string]$JdkHome) {
    $release = Join-Path $JdkHome 'release'
    if (-not (Test-Path $release)) { return 0 }
    $m = Select-String -Path $release -Pattern 'JAVA_VERSION="(\d+)' | Select-Object -First 1
    if ($m) { return [int]$m.Matches[0].Groups[1].Value }
    return 0
}

function Find-Jdk21 {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
    $searchDirs = @(
        "$env:USERPROFILE\.jdks",
        'C:\Program Files\Java',
        'C:\Program Files\Eclipse Adoptium',
        'C:\Program Files\Microsoft',
        'C:\Program Files\Amazon Corretto',
        'C:\Program Files\Zulu'
    )
    foreach ($dir in $searchDirs) {
        if (Test-Path $dir) {
            $candidates += Get-ChildItem $dir -Directory | Sort-Object Name -Descending | ForEach-Object { $_.FullName }
        }
    }
    foreach ($c in $candidates) {
        if ((Test-Path (Join-Path $c 'bin\java.exe')) -and (Get-JdkMajor $c) -eq 21) { return $c }
    }
    return $null
}

function Test-Docker {
    cmd /c "docker info >nul 2>nul"
    return $LASTEXITCODE -eq 0
}

function Test-EnginePort {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $Port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# 1. JDK 21
$jdk = Find-Jdk21
if (-not $jdk) {
    Exit-WithError "JDK 21을 찾지 못했습니다. IntelliJ의 Project Structure > SDK에서 JDK 21을 받거나 'winget install Microsoft.OpenJDK.21'로 설치하세요."
}
$env:JAVA_HOME = $jdk
Write-Step "JDK: $jdk"

# 2. Java 소켓 임시 폴더
$socketTmp = Join-Path $Root '.tmp'
New-Item -ItemType Directory -Force $socketTmp | Out-Null
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$socketTmp"

# 3. Docker
if (-not (Test-Docker)) {
    $dockerExe = @(
        "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
        'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $dockerExe) {
        Exit-WithError 'Docker Desktop을 찾지 못했습니다. 설치한 뒤 다시 실행하세요.'
    }
    Write-Step 'Docker Desktop을 켜는 중... (최대 2분)'
    Start-Process $dockerExe
    $deadline = (Get-Date).AddMinutes(2)
    while (-not (Test-Docker)) {
        if ((Get-Date) -gt $deadline) { Exit-WithError 'Docker가 2분 안에 켜지지 않았습니다. Docker Desktop 창을 확인하세요.' }
        Start-Sleep -Seconds 2
    }
}
Write-Step 'Docker 준비 완료'

# 4. 엔진
if (Test-EnginePort) {
    Write-Step "엔진이 이미 실행 중입니다 (포트 $Port)"
} else {
    Write-Step "엔진을 새 창에서 실행합니다. 처음에는 Gradle 다운로드로 1~2분 걸릴 수 있습니다."
    $engineDir = Join-Path $Root 'engine'
    $engineCommand = "`$Host.UI.RawUI.WindowTitle = 'DotShell 엔진'; Set-Location -LiteralPath '$engineDir'; .\gradlew.bat bootRun"
    Start-Process powershell -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $engineCommand)
    $deadline = (Get-Date).AddMinutes(5)
    while (-not (Test-EnginePort)) {
        if ((Get-Date) -gt $deadline) { Exit-WithError "엔진이 5분 안에 뜨지 않았습니다. 'DotShell 엔진' 창의 로그를 확인하세요." }
        Start-Sleep -Seconds 2
    }
    Write-Step '엔진 준비 완료'
}

# 5. 게임 창
$clientDir = Join-Path $Root 'client'
Push-Location $clientDir
try {
    if (-not (Test-Path 'node_modules')) {
        Write-Step '클라이언트 패키지를 설치하는 중...'
        npm install
        if ($LASTEXITCODE -ne 0) { Exit-WithError 'npm install에 실패했습니다.' }
    }
    if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) {
        Write-Step 'Electron 실행 파일을 받는 중...'
        node node_modules\electron\install.js
    }
    Write-Step '게임 창을 엽니다. 창을 닫아도 엔진 창은 켜져 있으니 다시 실행하면 바로 연결됩니다.'
    npm start
} finally {
    Pop-Location
}
