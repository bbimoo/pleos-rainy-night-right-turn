param(
    [string]$Avd = "Pleos_Connect_v2.1.0_API34",
    [string]$SdkPath = $(if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" })
)

$ErrorActionPreference = "Stop"
$emulatorPath = Join-Path $SdkPath "emulator\emulator.exe"
if (-not (Test-Path $emulatorPath)) {
    throw "Android emulator not found: $emulatorPath. Pass -SdkPath with your SDK directory."
}
# Printable keys otherwise travel through text conversion, which can turn
# held Space into short down/up pairs. Driving controls need the real edges.
# Use a cold boot for the Pleos VHAL. No user data is wiped.
& $emulatorPath -avd $Avd -no-snapshot-load -use-keycode-forwarding
exit $LASTEXITCODE
