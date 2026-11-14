# Android 호스트 (Pleos Connect)

`web/`의 게임을 WebView로 띄우고, Pleos Vehicle SDK 값을 게임에 넘겨주는 앱입니다.

## 준비물

- Android Studio (최신 안정판), JDK 17
- Node.js 18 이상 (웹 게임 빌드)
- Pleos Connect 에뮬레이터 **v2.1.0** (API 34 이미지). Virtual Console도 v2.1.0 이상이 필요합니다.
  - 이전 버전 에뮬레이터가 있으면 먼저 삭제합니다.
  - Android Studio에서 SDK Manager → SDK Update Sites → `+`
    - Name: `Pleos Connect System Image`
    - URL (Windows/Linux): `https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml`
    - URL (Mac): `https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-arm64-sys-img.xml`
  - SDK Platforms에서 Android API Level 34의 Pleos Connect system image를 설치합니다.
  - Device Manager → Automotive → `Pleos Connect v2.1.0`, RAM 4GB, Default boot는 **Cold**여야 합니다. Quick boot로 두면 VHAL을 쓸 수 없습니다.
  - 그래픽 카드가 필수입니다. 최소 RTX 3060 Laptop 6GB / RX 6600M 8GB, 권장 RTX 4060·5060 Laptop 8GB.
  - 출처: [개발 환경 설정](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator), [에뮬레이터 설정](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/configure-pleos-connect-emulator)

## 공식 개발 환경 요구사항 대응

| 공식 요구사항 | 이 프로젝트 |
|---|---|
| Minimum Android SDK: API 28 이상 | `minSdk = 28` |
| Gradle 8.0 이상 | Gradle 8.10.2 (wrapper) |
| 개발 언어 Java, Kotlin | Kotlin 2.0.0 |
| Pleos Connect Emulator 2.1.0 | 위 설치 절차 |

compileSdk/targetSdk 35, AGP 8.8.2, JDK 17은 공식 문서가 정하지 않은 값입니다. Pleos 공식 Vehicle 샘플 앱과 같은 값을 썼습니다.

## 빌드와 실행

1. 레포 루트에서 웹 게임 번들을 만듭니다.
   ```sh
   node build.mjs
   ```
2. Android Studio에서 `android/` 폴더를 엽니다. Gradle Sync가 끝나면 에뮬레이터를 골라 Run합니다.
   빌드할 때 `buildWebGame`이 Node.js로 현재 `web/` 소스를 번들링한 후 `syncWebGame`이 `assets/web/index.html`로 자동 복사합니다. Android Studio의 빌드 환경에서도 `node`가 PATH에 있어야 합니다.
3. Android 폴더에서 명령줄로 빌드합니다.
   ```powershell
   .\gradlew.bat :app:assembleDebug
   ```
   macOS/Linux에서는 `./gradlew :app:assembleDebug`를 사용합니다. 포함된 Wrapper JAR는 Gradle 8.10.2 공식 SHA-256과 일치합니다.

   Windows에서 `Your project path contains non-ASCII characters` 오류가 나면, 영문 경로(예: `C:/dev/pleos-driving-game`)에서 프로젝트를 엽니다.

## PC 키보드로 에뮬레이터에서 주행하기

이 환경에서는 길게 누른 Space가 IME 전 단계부터 수 ms 길이의 keydown/keyup 쌍으로 반복 수신됩니다. Android 호스트는 주행 중 Space와 ↑를 `dispatchKeyEventPreIme`에서 받아 기존 웹 KeyboardAdapter로 전달합니다. ranchu/goldfish 에뮬레이터에서 20ms 이하의 짧은 입력은 다음 반복을 최대 200ms 기다려 하나의 유지 입력으로 합칩니다. 이 경로의 키 해제는 마지막 반복 후 최대 200ms 지연될 수 있습니다. 정상적으로 길게 누른 키의 해제와 실제 기기의 키 해제는 즉시 전달합니다. 포커스 상실·앱 일시정지·P단 차단 시에는 대기 중인 해제를 취소하고 즉시 누름 상태를 비웁니다. 브리핑·결과 화면의 Space 버튼 동작은 가로채지 않습니다.

아래 실행 스크립트는 에뮬레이터 키코드 전달 경로를 비교하는 진단용입니다. `-use-keycode-forwarding`만으로는 이 환경의 짧은 키 이벤트 문제가 해결되지 않아, 앱의 IME 전 입력 처리를 함께 적용했습니다.

기존 에뮬레이터를 종료한 뒤 Android 폴더에서 다음처럼 실행합니다.

```powershell
.\start-pleos-keyboard.ps1
# AVD 이름이 다르면:
.\start-pleos-keyboard.ps1 -Avd "내_AVD_이름"
```

스크립트는 `-use-keycode-forwarding`으로 키코드를 직접 전달하고, Pleos 차량 서비스에 필요한 cold boot를 사용합니다. 사용자 데이터는 초기화하지 않습니다. 실행된 기기를 Android Studio에서 선택해 Run하세요. Device Manager로 새로 실행하면 이 명령줄 옵션이 적용되지 않습니다.

연습 차량은 D단 주행을 가정합니다. 페달 입력이 없으면 부드럽게 출발해 약 10 km/h의 크리핑 속도로 수렴합니다. 키보드 ↑로 최대 30 km/h까지 가속하고, 놓으면 크리핑 속도로 서서히 돌아옵니다. Space 또는 차량/가상 브레이크로 정지하며, 완전 정지를 유지하려면 브레이크를 계속 밟아야 합니다. 브레이크를 놓으면 다시 크리핑합니다. 이는 연습 시뮬레이션의 설정이며 실제 차량의 P단 조건·UX 안전 차단은 유지합니다. 터치 가속 버튼·게임패드·차량 가속 입력은 사용하지 않습니다.

회귀 검사: Debug 앱의 WebView를 `tcp:9223`으로 포워딩한 뒤 `node tests/native-space.cjs`를 실행합니다. CDP 키 입력 대신 Android 키 주입으로 3.5초 유지 및 40회의 짧은 키 쌍 반복을 각각 검사합니다. ↑ 가속·해제 후 감속, 정상 키의 눌림/해제 전달, 반복 쌍 병합, 브레이크 유지 시 완전 정지 및 해제 후 크리핑 재개를 검사합니다. 차량 READ 상태는 테스트 메시지이며 실제 PC 키보드 재확인과 구분합니다.

## 차량 값 넣어 보기 (Virtual Console)

```sh
adb forward tcp:8088 tcp:8088
```
PC 브라우저에서 http://127.0.0.1:8088/ 을 열고 Motion에서 기어, 브레이크, 조향각을 바꿉니다.
기어가 **P**일 때만 게임이 열립니다.

WebView 디버깅: 디버그 빌드에서 Chrome의 `chrome://inspect`로 접속하면
`window.__game.getState()` 같은 테스트 훅을 그대로 쓸 수 있습니다.

## 구조

| 파일 | 역할 |
|---|---|
| `MainActivity.kt` | WebView, `WebViewAssetLoader`, `PleosHost.ready()` 노출, 메시지 전달 |
| `VehicleBridge.kt` | Vehicle SDK: 기어(→ `parked`), 방향지시등, 조향각, 브레이크를 읽어 게임 메시지로 변환 |
| `UxRestrictionsSource.kt` | `CarUxRestrictionsManager` → `uxRestrictions` 메시지 |

| 게임 메시지 | SDK | 권한 |
|---|---|---|
| `parked` | `Gear.registerGearSelection` (`GEAR_PARK`이면 true) | `CAR_DRIVE` |
| `turnSignal` | `TurnSignal.registerTurnSignalState` | `CAR_LIGHTS` |
| `steeringAngle` | `SteeringWheel.registerSteeringWheelAngle` | `CAR_DRIVE` |
| `brakePedal` | `Brake.registerBrakePedalStatus` | `CAR_DRIVE` |
| `acceleratorPedal` | 없음 (Vehicle SDK 2.3.2에 읽기 API가 없습니다) → 게임 터치 버튼 사용 | - |

## 남은 확인 사항

- **조향각 보정**: SDK 값(도)을 그대로 넘기고, 게임(`web/input.js`)이 핸들 **450°를 최대 조향**으로 바꿉니다. ±2°는 무시합니다(손을 얹은 정도). 우회전 판정은 약 116°부터입니다. Pleos 에뮬레이터에서 실제 범위와 방향(오른쪽이 +인지)을 확인하고, 다르면 게임 주소에 `?steerLock=<도>`나 `?steerSign=-1`을 붙여 맞춥니다.
- **권한 승인**: 선언한 권한(`CAR_DRIVE`, `CAR_LIGHTS`)은 Pleos App Market 심사에서 승인받아야 합니다.
- **applicationId** `com.rainyturn.game`은 임시 값입니다. 팀 도메인으로 바꾸세요.
- **릴리스 서명**: `android/keystore.properties`(`storeFile`, `storePassword`, `keyAlias`, `keyPassword`)를 만들면 `assembleRelease`가 서명된 APK를 만듭니다. 이 파일과 keystore는 커밋하지 마세요.
- 앱 아이콘이 아직 없습니다.
