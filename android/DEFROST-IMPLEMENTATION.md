# 앞유리 김서림 제거 연습 (2026-11-13)

작업 브랜치: dev/fog-effects. 기존 보행자/안개 변경과 앞유리 김서림 제거 연습을 함께 포함한다. 실제 SDK 검증과 모의 검증 결과는 아래에서 구분한다.

## 동작

- web/app.js가 실제 우회전 궤적 진입점(Drive.track.turnStart) 약 2 m 전에 한 번 정지시킨다. 키 조향을 미리 유지해도 차체 yaw가 변하기 전이다.
- web/defrost.js가 각 판의 waiting → requesting → clearing → done을 관리한다. 정지 중 Drive.step을 호출하지 않으므로 주행 거리, run.t, 보행자 위치와 출현/반응 시간, 판정 시간이 멈춘다. 자동 정지는 운전자 제동/횡단보도 정지 기록에 넣지 않는다.
- 연습 차량 속도를 0으로 만들고, 완료 후 같은 좌표에서 기존 크리핑/가속 입력으로 다시 출발한다.
- 김서림은 앞유리 모양으로 잘린 반투명 DOM 레이어 한 장이다. opacity만 1.6초에 걸쳐 줄인다. 대기·제거 중 기존 Canvas 그림을 유지하며 매 프레임 blur, 스냅샷, 이미지 재생성을 하지 않는다.
- F(KeyF, 소문자/대문자 key fallback)와 터치 버튼은 같은 GameInput defrost 명령이다. Android는 F를 pre-IME에서 보존해 WebView에 전달하므로 Virtual Console을 열 필요가 없다.
- 브라우저와 일반 폰의 debug/non-automotive 모드만 모의 ON을 허용하며 화면·메시지·리포트에 모의임을 표시한다. Pleos/automotive에는 모의 성공 우회가 없다.

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

DefrosterController.kt는 기존 VehicleBridge의 초기화된 연결을 공유한다. 지원 영역과 READ/READ_WRITE를 확인하고 현재 ON이면 set을 생략한다. OFF일 때만 WRITE 권한과 READ_WRITE를 확인해 true를 요청한다. set 완료 콜백은 SDK 구현에서 요청값을 되돌려 주므로 ON 증거로 사용하지 않는다. get의 true 또는 SDK 리스너의 true만 성공이다. 요청 전체 제한은 8초이고 웹에는 10초의 호스트 무응답 제한도 있다.

## 안전/취소

- 네이티브의 P단·UX 제한·Activity resumed/focus·연습 상태 조건이 제어 직전에 다시 확인된다.
- 차단/Activity pause/페이지 교체/게임 초기화/종료는 요청을 취소한다. 요청 세대와 고유 ID가 다른 늦은 콜백은 무시된다.
- 웹에서도 P 아님·UX 제한·수동 일시정지·비활성 상태의 F/터치를 막는다. 제거 진행도 역시 멈춘다.
- P 복귀만으로 재개하지 않는다. 기존 ‘P단에서 이어하기’를 눌러야 한다. 중단된 SDK 요청은 F/버튼으로 다시 상태를 확인한다.
- 권한 부족, 미지원, SDK 실패, null 상태, 시간 초과 시 김서림/정지를 유지하고 이유와 재시도 안내를 표시한다. SDK가 ON을 확인하지 않은 상태에서 진행하는 건너뛰기는 없다.

## 검증 결과와 한계

통과:

- node tests/defrost.cjs: ON 확인 전 대기, 같은 시간/좌표, 한 판 한 번, 중복 입력, 1.6초 opacity 변화, 차단 중 제거 정지, 늦은 콜백 무시, 권한/미지원/오류/시간 초과 후 재시도.
- node tests/input.cjs, node tests/drive.cjs: 기존 차량/키/터치/물리·판정 회귀.
- node tests/ui.cjs: 실제 CSP 번들의 기존 11개 화면·성공/실패·리포트·P단 수동 재개, 김서림 전후 위치/보행자 시간 고정, F와 터치.
- node tests/scene.cjs --demo: 기존 Canvas 가림·시점·와이퍼·성공 흐름, 크기 변경.
- gradlew.bat :app:assembleDebug :app:lintDebug --offline: 성공. 두 에뮬레이터에 APK 설치·실행.
- 일반 폰 Medium_Phone_API_36.1: 실제 Android KEYCODE_F 및 WebView 터치로 모의 ON → 제거 → 같은 위치 재개. source=mock-debug이며 실제 차량 호출이 아니다.
- 일반 폰의 D단/UX 회귀는 WebView 안전 메시지를 주입한 검사다. F/터치가 호스트 요청을 발생시키지 않고 복귀 후에도 수동 이어하기가 필요함을 확인했다. 네이티브 P단 차단을 우회하거나 해제한 검사가 아니다.

Pleos 실제 SDK 관측:

- Pleos Connect v2.1.0 API34 자동차 에뮬레이터에서 실제 기어 P를 수신한 상태로 테스트했다.
- F → Android 호스트 → capability READ_WRITE, FRONT_WINDSHIELD 지원 확인 → 실제 get OFF → setHvacDefroster(true) → set 완료 콜백까지 확인했다.
- 이후 get은 계속 false였고 register 리스너도 false를 반환했다. true/ON은 관측되지 않았다.
- 실제 터치 재시도도 동일하게 SDK 요청/완료 콜백까지 도달했다. ON 미확인으로 각각 시간 초과가 표시됐으며 같은 run.t/s/x/z와 opacity .82를 유지했다.
- 따라서 실제 SDK의 ON 수신 → 제거 → 재개 종단 성공과 이미 ON인 실차에서 set 생략은 현재 환경에서 미확인이다. 이를 모의 성공으로 대체하지 않았다.
- Virtual Console에는 상태 GET만 시도했으며 localhost:8088에 연결되지 않았다. Console로 값을 바꾸지 않았다. SDK가 OFF를 유지하는 원인(DDS/차량 서비스/공조 상태 등)은 이번 관측만으로 확정하지 않는다.
- 실제 D단/UX 상태 변경의 종단 검사는 미확인이다. car_service help조차 user build의 SecurityException으로 제한되어 있으며 이를 우회하지 않았다.

증거:
- android/app/build/defrost-report/sdk-unconfirmed.json
- android/app/build/defrost-report/mock-debug.json
- android/app/build/ui-report/16-condensation.png
- SDK 호출/false 상태는 adb logcat -s Defroster:I
- 재실행: Pleos에서 node tests/webview-defrost.cjs (ON 미수신은 실패로 종료). 현재 환경의 OFF/시간 초과 회귀만 검사하려면 명시적으로 --allow-sdk-off를 추가한다. 이 옵션도 모의 ON을 주입하지 않는다.
- 테스트 실행 전 대상 프로세스의 webview_devtools_remote_<pid>를 tcp:9223에 forward하고, 일반 폰은 ANDROID_SERIAL=emulator-5556을 지정한다.

APK: android/app/build/outputs/apk/debug/app-debug.apk
