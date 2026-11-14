# 앞유리 김서림 제거 연습 (2026-11-13)

작업 브랜치: dev/fog-effects. 기존 보행자/안개 변경과 앞유리 김서림 제거 연습을 함께 포함한다. 실제 SDK 검증과 모의 검증 결과는 아래에서 구분한다.

## 제출 release 추가 변경 (2026-11-14)

- 사용자가 18d7ee9 이후의 로컬 김서림 변경까지 제출 APK에 포함하고, 자동차 에뮬레이터의 SDK SET 수락 방식도 release에서 사용하도록 선택했다. 실제 차량 ON 확인과 네이티브 안전 제한은 유지한다.
- minify된 release 실기동에서 Vehicle SDK의 capability 응답이 `TypeToken must be created with a type argument`로 실패하는 문제를 발견했다. SDK 2.3.2의 전이 의존성은 Gson 2.10.1이다.
- app/proguard-rules.pro에 Gson 공식 안내의 Signature와 TypeToken 계층 보존 규칙을 추가한다. R8 및 리소스 축소는 계속 사용한다. 이 변경도 제출 레포에 반영해야 한다.
- APK의 최종 서명·해시·release 검증 기록은 app/build/release-report.md를 확인한다. 키와 비밀번호는 Git 제외 경로에만 보관하며 제출 코드나 APK에 넣지 않는다.

## 동작

- 주행 시작 시 web/defrost.js의 occurrenceChance=.5로 앞유리 김서림 유무를 한 번 추첨한다. 보행자 유무/시나리오와 별개의 추첨이며, 같은 판에서는 다시 발생하지 않는다. 재시작하면 새로 추첨한다.
- 김서림이 있는 판은 출발 화면부터 앞유리에 opacity .82의 반투명 레이어가 보인다. cockpit.webp의 실제 유리 윤곽을 따르는 정적 SVG 클립을 사용하며 룸미러·기둥·대시보드는 제외한다. 위쪽은 짙고 아래쪽은 옅은 CSS 그라데이션이며, 좌우 시점에 따른 콕핏 이동과 같은 비율로 레이어만 이동한다. 실행 중 윤곽 추출이나 이미지 재생성은 하지 않는다. 없는 판에는 효과와 제거 패널을 표시하지 않으며 회전 직전에 추가 발생하지 않는다.
- 이전의 회전 직전 강제 정지/시간 정지 방식은 제거했다. 김서림 대기·SDK 확인·제거 중에도 Drive.step과 Canvas 렌더링, 거리·보행자 시간·페달·조향 조작이 정상 진행한다. 시야가 불편하면 사용자가 F나 제거 버튼을 선택한다.
- 큰 정지 안내창 대신 HUD와 겹치지 않는 작은 왼쪽 하단 버튼과 상태 메시지를 표시한다. HUD와 터치 주행 조작은 김서림 레이어 위에서 계속 사용할 수 있다.
- 실제 차량은 SDK에서 ON을 확인하면, 자동차 에뮬레이터는 SDK 켜기 요청 수락 콜백이 오면 1.6초 동안 opacity만 줄인다. 에뮬레이터 연습 방식은 사용자 선택으로 허용됐으며 제출 release에도 적용한다. 일반 폰 release는 모의 모드가 없다. 김서림에 매 프레임 blur, 스냅샷, 이미지 재생성을 추가하지 않는다.
- F(KeyF 및 key fallback)와 터치 버튼은 같은 GameInput defrost 명령이다. Android의 pre-IME 전달과 Vehicle SDK 요청 경로는 유지하며 Virtual Console을 열 필요가 없다.
- 브라우저와 일반 폰 debug/non-automotive 모드는 모의 ON을 사용한다. 별도로, FEATURE_AUTOMOTIVE이며 자동차 에뮬레이터(ranchu/goldfish 또는 emulator 모델+avd 제품)일 때만 실제 SDK SET 수락으로 연습을 진행한다. 실제 차량은 관측한 ON이 없으면 제거하지 않는다. SDK 실패/권한 부족/미지원/요청 무응답에는 연습 성공 우회가 없다.

## 설치 SDK 2.3.2에서 확인한 계약

설치된 ai.pleos.playground:Vehicle:2.3.2 sources.jar의 HVAC.kt, WindowArea.kt, WindowValue.kt를 기준으로 확인했다.

- Vehicle.getHVAC()
- 앞유리: WindowArea(WindowValue.FRONT_WINDSHIELD). 뒷유리 값은 사용하지 않는다.
- checkHvacDefrosterCapabilities(onComplete: (CapabilityConfig, List<WindowArea>) -> Unit, onFailed: (Exception) -> Unit)
- setHvacDefroster(area: WindowArea, value: Boolean, onComplete: (WindowArea, Boolean?) -> Unit, onFailed: (Exception) -> Unit)
- getHvacDefrosterState(area: WindowArea, onComplete: (Boolean?) -> Unit, onFailed: (Exception) -> Unit)
- registerHvacDefrosterState(area: WindowArea, listener: HvacDefrosterStateListener)
- 리스너: onHvacDefrosterStateUpdated(Boolean?), onFailed(Exception). 종료/취소 시 unregisterHvacDefrosterState.
- 조회/지원 확인/리스너: pleos.car.permission.CAR_CLIMATE
- 켜기: pleos.car.permission.CONTROL_CAR_CLIMATE
- SDK 문서상 두 권한은 normal. Manifest에 선언하고 요청 단계마다 실제 권한을 확인하며 SecurityException을 처리한다. 별도 dangerous 권한 팝업을 만들지 않았다.

DefrosterController.kt는 기존 VehicleBridge의 초기화된 연결을 공유한다. 지원 영역과 READ/READ_WRITE를 확인하고 현재 ON이면 set을 생략한다. OFF일 때만 WRITE 권한과 READ_WRITE를 확인해 true를 요청한다. set 완료 콜백은 요청 수락이며 실제 ON 증거로 사용하지 않는다. 실차는 get의 true 또는 SDK 리스너의 true가 필요하다. 승인된 자동차 에뮬레이터만 SET 완료 시 status=accepted, accepted=true, confirmed=false, source=sdk-emulator를 보낸다. 웹은 이 구분을 유지해 연습 효과만 제거하고 'SDK 앞유리 ON 확인'으로 기록하지 않는다. 요청 전체 제한은 8초이고 웹에는 10초의 호스트 무응답 제한도 있다.

## 안전/취소

- 네이티브의 P단·UX 제한·Activity resumed/focus·연습 상태 조건이 제어 직전에 다시 확인된다.
- 차단/Activity pause/페이지 교체/게임 초기화/종료는 요청을 취소한다. 요청 세대와 고유 ID가 다른 늦은 콜백은 무시된다.
- 웹에서도 P 아님·UX 제한·수동 일시정지·비활성 상태의 F/터치를 막는다. 제거 진행도 역시 멈춘다.
- P 복귀만으로 재개하지 않는다. 기존 ‘P단에서 이어하기’를 눌러야 한다. 중단된 SDK 요청은 F/버튼으로 다시 상태를 확인한다.
- 권한 부족, 미지원, SDK 실패, null 상태, 시간 초과 시 김서림을 유지하고 이유와 재시도 안내를 표시한다. 게임 주행은 계속 가능하다. 실차는 ON 확인, 자동차 에뮬레이터는 실제 SET 수락이라는 각 모드의 성공 조건을 충족해야 제거한다.

## 검증 결과와 한계

통과:

- node tests/defrost.cjs: 50% 추첨 경계, 한 판 한 번 추첨, 재시작 시 재추첨, 속도/가속 강제 변경 없음, ON 확인 전 김서림 유지, 중복 요청, 1.6초 opacity 변화, 차단 중 제거 정지, 늦은 콜백 무시, 실패 후 재시도.
- node tests/input.cjs, node tests/drive.cjs: 기존 차량/키/터치/물리·판정 회귀.
- node tests/ui.cjs: 실제 CSP 번들의 기존 11개 화면·성공/실패·리포트·P단 수동 재개, 출발 즉시 김서림 있음/없음, 회전 지점에서 추가 발생 없음, 김서림 상태의 주행/제동, HUD 비가림, F와 터치.
- node tests/scene.cjs --demo: 기존 Canvas 가림·시점·와이퍼·성공 흐름, 크기 변경.
- gradlew.bat :app:assembleDebug :app:lintDebug --offline: 성공. 두 에뮬레이터에 APK 설치·실행.
- 이전 커밋 18d7ee9의 일반 폰 Medium_Phone_API_36.1 검증: 실제 Android KEYCODE_F 및 WebView 터치로 모의 ON → 제거 → 재개. source=mock-debug이며 실제 차량 호출이 아니다.
- 이전 일반 폰의 D단/UX 회귀는 WebView 안전 메시지를 주입한 검사다. F/터치가 호스트 요청을 발생시키지 않고 복귀 후에도 수동 이어하기가 필요함을 확인했다. 네이티브 P단 차단을 우회하거나 해제한 검사가 아니다.

## 승인된 에뮬레이터 연습 방식 검증

- 사용자가 Console 없이 F로 연습하도록 에뮬레이터 연습 방식을 선택했다.
- 설치된 Pleos debug APK에서 실제 Android KEYCODE_F → SDK 지원/권한/현재 상태 확인 → setHvacDefroster(true) → 수락 콜백 → status=accepted → 김서림 제거 완료를 확인했다. 실제 WebView 터치도 동일하게 통과했다.
- source=sdk-emulator, actualSdkOnVerified=false를 기록한다. 실제 SDK 요청은 보냈지만 하드웨어 ON으로 보고하지 않는다.
- D단/UX 메시지 주입 시 F/터치가 요청을 발생시키지 않으며 복귀 후 수동 이어하기가 필요함을 다시 확인했다.
- node tests/defrost.cjs는 실제 차량의 SET 수락이 ON으로 처리되지 않는지, 에뮬레이터 전용 accepted 메시지, 차단 중 늦은 accepted 무시를 검사한다.
- 증거는 android/app/build/defrost-report/sdk-emulator.json에 저장했다.
- Console 웹 UI나 상태 변경 API는 사용하지 않았다. 상태 GET 조회만으로 HVAC defog publisher/subscription 준비 상태가 false임을 확인했다.

이전의 엄격한 ON 확인 모드에서 관측한 내용:

- Pleos Connect v2.1.0 API34 자동차 에뮬레이터에서 실제 기어 P를 수신한 상태로 테스트했다.
- F → Android 호스트 → capability READ_WRITE, FRONT_WINDSHIELD 지원 확인 → 실제 get OFF → setHvacDefroster(true) → set 완료 콜백까지 확인했다.
- 이후 get은 계속 false였고 register 리스너도 false를 반환했다. true/ON은 관측되지 않았다.
- 실제 터치 재시도도 동일하게 SDK 요청/완료 콜백까지 도달했다. ON 미확인으로 시간 초과가 표시됐다. 출발 시 김서림 방식에서는 시간·거리는 계속 진행하고 opacity .82는 유지한다.
- 따라서 실제 SDK의 ON 수신 → 제거 종단 성공과 이미 ON인 실차에서 set 생략은 현재 환경에서 미확인이다. 이를 모의 성공으로 대체하지 않았다.
- 이전에는 localhost:8088 포워딩이 없어 상태 GET에 연결되지 않았다. 이번에는 adb forward 후 읽기 전용 조회로 HVAC publisher_ready.defog=false, subscription_ready.defog=false, emulator_active=false를 확인했다. Console로 값을 바꾸지 않았다. SDK의 SET이 수락돼도 실제 ON으로 관측되지 않는 현재 에뮬레이터 상태와, 게임 연습 성공을 구분한다.
- 실제 D단/UX 상태 변경의 종단 검사는 미확인이다. car_service help조차 user build의 SecurityException으로 제한되어 있으며 이를 우회하지 않았다.

증거:
- android/app/build/defrost-report/sdk-unconfirmed.json
- android/app/build/defrost-report/mock-debug.json
- android/app/build/ui-report/16-condensation.png
- SDK 호출/false 상태는 adb logcat -s Defroster:I
- 재실행: debug Pleos 에뮬레이터에서 node tests/webview-defrost.cjs는 실제 SDK 수락 이후 연습 제거까지 확인한다. 실차의 ON 미수신은 여전히 실패다. --allow-sdk-off는 엄격한 확인 모드의 OFF/시간 초과 회귀를 위한 진단 옵션이며 ON을 주입하지 않는다.
- 테스트 실행 전 대상 프로세스의 webview_devtools_remote_<pid>를 tcp:9223에 forward하고, 일반 폰은 ANDROID_SERIAL=emulator-5556을 지정한다.

APK: android/app/build/outputs/apk/debug/app-debug.apk
