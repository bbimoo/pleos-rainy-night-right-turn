# 제출용 APK

공모전 규칙에 따라 서명된 **release** APK를 이 폴더에 둡니다.

- 파일명: `팀명_앱이름_release.apk`
- 디버그 빌드(`app-debug.apk`)나 서명되지 않은 빌드(`app-release-unsigned.apk`)는 넣지 않습니다. 서명이 없으면 기기에 설치되지 않습니다.
- 파일이 너무 크면 GitHub Release에 올리고 그 링크를 루트 README의 "APK 위치"에 적습니다.

## 만드는 방법

1. Android Studio에서 **Build → Generate Signed App Bundle or APK → APK**를 고르고, 팀 키스토어(.jks)로 **release** 빌드를 만듭니다.
   키스토어와 비밀번호는 팀만 보관하고 절대 커밋하지 않습니다.
2. 레포 루트의 PowerShell에서 아래 스크립트를 실행합니다. 서명을 검증한 뒤 규칙에 맞는 이름으로 이 폴더에 복사합니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1 -Team "팀명" -App "앱이름"
```
