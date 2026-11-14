<#
공모전 제출물을 준비합니다.

1. 서명된 release APK를 찾아 서명을 검증합니다 (디버그 키 서명, 미서명, debuggable 빌드는 거부).
2. apk/팀명_앱이름_release.apk 로 복사합니다.
3. -Zip 을 주면 .gitignore를 따르는 깨끗한 제출용 zip을 레포 바깥(상위 폴더)에 만듭니다.
   빌드 결과물, 로컬 설정(local.properties), 서명 키, 개인 작업 파일(.omc)은 들어가지 않습니다.

예)
  powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1 -Team "팀명" -App "앱이름"
  powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1 -Team "팀명" -App "앱이름" -Zip
  powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1 -Team "팀명" -App "앱이름" -ApkPath "D:\out\app-release.apk"
#>
param(
    [Parameter(Mandatory = $true)][string]$Team,
    [Parameter(Mandatory = $true)][string]$App,
    [string]$ApkPath,
    [switch]$Zip
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Fail([string]$message) {
    Write-Host "실패: $message" -ForegroundColor Red
    exit 1
}

foreach ($part in @($Team, $App)) {
    if ($part -match '[\\/:*?"<>|\s]') { Fail "팀명/앱이름에 공백이나 파일명에 쓸 수 없는 문자가 있습니다: '$part'" }
}

# 1. APK 찾기 -------------------------------------------------------------
if (-not $ApkPath) {
    $candidates = @(
        (Join-Path $repo 'android\app\release\app-release.apk'),                   # Android Studio: Generate Signed APK
        (Join-Path $repo 'android\app\build\outputs\apk\release\app-release.apk')  # gradlew assembleRelease + keystore.properties
    ) | Where-Object { Test-Path $_ }
    if (-not $candidates) {
        Fail "서명된 release APK가 없습니다. Android Studio에서 Build > Generate Signed App Bundle or APK > APK > release 로 먼저 만드세요. (app-release-unsigned.apk 는 설치할 수 없어 사용하지 않습니다.)"
    }
    $ApkPath = $candidates | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1
}
if (-not (Test-Path $ApkPath)) { Fail "APK 파일이 없습니다: $ApkPath" }
Write-Host "APK: $ApkPath"

# 2. 서명과 빌드 종류 검증 ------------------------------------------------
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$buildTools = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [version]($_.Name -replace '[^0-9.].*$', '') } -Descending | Select-Object -First 1
if (-not $buildTools) { Fail "Android SDK build-tools를 찾지 못했습니다 ($sdk)." }
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$aapt = Join-Path $buildTools.FullName 'aapt.exe'

# 외부 도구는 오류를 stderr로 내보내므로, 여기서는 PowerShell이 그걸 예외로 바꾸지 않게 합니다.
$ErrorActionPreference = 'Continue'
$verify = & $apksigner verify --print-certs $ApkPath 2>&1 | ForEach-Object { "$_" } | Out-String
$verifyCode = $LASTEXITCODE
$badging = & $aapt dump badging $ApkPath 2>&1 | ForEach-Object { "$_" } | Out-String
$ErrorActionPreference = 'Stop'

if ($verifyCode -ne 0) { Fail "서명 검증 실패 (서명되지 않았거나 손상된 APK입니다).`n$verify" }
if ($verify -match 'CN=Android Debug') { Fail "디버그 키로 서명된 APK입니다. 팀 키스토어로 서명한 release 빌드를 쓰세요." }

if ($badging -match "application-debuggable") { Fail "debuggable 빌드입니다. release 빌드를 쓰세요." }
if ($badging -match "package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'") {
    Write-Host ("패키지 {0}, 버전 {1} ({2})" -f $Matches[1], $Matches[3], $Matches[2])
}
Write-Host "서명 확인 완료" -ForegroundColor Green

# 3. apk/ 폴더로 복사 -----------------------------------------------------
$apkDir = Join-Path $repo 'apk'
New-Item -ItemType Directory -Force $apkDir | Out-Null
$target = Join-Path $apkDir ("{0}_{1}_release.apk" -f $Team, $App)
Copy-Item $ApkPath $target -Force
$others = Get-ChildItem $apkDir -Filter *.apk | Where-Object { $_.FullName -ne $target }
foreach ($o in $others) { Write-Host "참고: apk/ 에 다른 APK가 있습니다 (정리하세요): $($o.Name)" -ForegroundColor Yellow }
Write-Host ("복사 완료: apk\{0} ({1:N1} MB)" -f (Split-Path $target -Leaf), ((Get-Item $target).Length / 1MB)) -ForegroundColor Green

# 4. (선택) 제출용 zip ----------------------------------------------------
if ($Zip) {
    Push-Location $repo
    try {
        # 커밋된 파일 + 아직 커밋 안 된 새 파일 중 .gitignore 에 걸리지 않는 것만
        $files = git -c core.quotepath=off ls-files --cached --others --exclude-standard
        if ($LASTEXITCODE -ne 0) { Fail "git 저장소가 아니거나 git을 실행할 수 없습니다." }
    } finally { Pop-Location }

    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $repoName = Split-Path $repo -Leaf
    $zipPath = Join-Path (Split-Path $repo -Parent) ("{0}_{1}_submission.zip" -f $Team, $App)
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    $archive = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
    try {
        foreach ($f in $files) {
            $full = Join-Path $repo $f
            if (-not (Test-Path $full -PathType Leaf)) { continue }  # 삭제됐지만 아직 커밋 안 된 파일
            $entry = "$repoName/" + ($f -replace '\\', '/')
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $full, $entry, 'Optimal')
        }
    } finally { $archive.Dispose() }
    Write-Host ("zip 생성: {0} ({1} 파일, {2:N1} MB)" -f $zipPath, $files.Count, ((Get-Item $zipPath).Length / 1MB)) -ForegroundColor Green
}
