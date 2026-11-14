# Figma 앱 영역 구현 및 검증

최신 앞유리 김서림 제거 연습과 실제 SDK/모의 검증 구분은 [김서림 구현 기록](android/DEFROST-IMPLEMENTATION.md)을 참고한다.

대상: `dev/android-host`, Figma `k8bQe5JMILYndfqhKuoZiy` 개발자 확인용 페이지 `230:7863`.

## 현재 가속 입력 규칙

사용자 요청에 따라 연습 차량은 D단의 크리핑을 모사한다. 0 km/h에서 시작해 페달 입력이 없으면 최대 0.55 m/s²로 부드럽게 출발하고 약 10 km/h에 수렴한다. 키보드 ↑로 최대 30 km/h까지 가속하고, ↑를 놓으면 크리핑 속도로 돌아온다. Space·가상 버튼·차량 브레이크로 정지하며 브레이크 유지 중에만 완전 정지를 유지한다. 브레이크를 놓으면 다시 크리핑한다. 이 속도·가속도는 연습용 설정이며 실차 계측 보정값은 아니다. 실제 Pleos 차량은 계속 P단이어야 하고, P단 해제·기어 불명·UX 제한의 안전 차단을 유지한다. 터치 가속 버튼·게임패드·차량 가속 메시지는 가속에 사용하지 않는다. 에뮬레이터 키 쌍 보정은 Space와 ↑를 독립적으로 처리한다. 아래 과거 기록의 ‘기본 20 km/h 복귀’ 또는 ‘브레이크 해제 후 정지 유지’ 설명은 이 규칙으로 대체된다.

## 확인한 현재 구조

- `MainActivity.kt` → `WebViewAssetLoader` → `https://appassets.androidplatform.net/assets/web/index.html`.
- `VehicleBridge.kt`에서 기어, 핸들, 브레이크, 방향지시등을 `window.MCER.Pleos.receive`로 전달한다. 가속 페달 SDK는 미지원이며 기존 키보드·터치 입력을 유지한다.
- `web/input.js`의 입력 중재, `web/drive.js`의 물리·판정, `web/scene.js`의 Canvas 렌더러를 재사용한다. 새 DOM HUD를 사용하는 앱에서는 기존 Canvas HUD만 옵션으로 끈다. 렌더러 기본 동작은 유지한다.
- `web/` → `node build.mjs` → `dist/index.html` → `syncWebGame` → APK `assets/web/index.html`. 이제 Gradle `buildWebGame`이 최신 소스 번들을 먼저 생성한다.
- 네이티브 기어 확인 실패·2.5초 이상 미갱신·UX 제한 시 차단하는 기존 경로는 유지한다. JS의 `practiceState`는 차단 안내 문구만 변경하며 네이티브 차단을 해제할 수 없다.

## 화면 대응

| 앱 영역 | 연결 |
|---|---|
| `230:7866` 차량 확인 | 실제 주차·capabilities·신호 수신 상태, PC/보조 입력 여부. 확인 후 브리핑 |
| `230:7898` 브리핑 | 기존 Canvas 미리보기, 목표 3개, 입력 안내, 기본 20 km/h |
| `230:7951` 시작 차단 | P 아님·기어 불명·UX 제한을 차단. 실제 기어 이름을 알 때만 표시 |
| `230:7968` 정면 | 기존 Canvas + 실제 연습 속도 HUD |
| `230:7985` 오른쪽 | 우측 신호, 기존 시선 이동, 감속 안내 |
| `230:8004` 왼쪽 | 좌측 신호, 기존 시선 이동, 오른쪽 확인 안내 |
| `230:8023` 일시정지 | P 해제 시 시뮬레이션 정지. P 복귀만으로 재개하지 않고 이어하기 필요 |
| `230:8044` 성공 결과 | 실제 `safe`/`clear`, 완전 정지 기록이 있을 때만 안전 정지 성공 제목 |
| `230:8111` 실패 결과 | 기존 `unsafe`/`missed`/`fast` 분류에 따른 설명 |
| `230:8181` 실패 리포트 | 실제 단서 이미지·속도·조작·시간순 이벤트 |
| `230:8283` 성공 리포트 | 동일 세션의 실제 기록, 재주행 |

1700 × 1184는 디자인 치수 기준이다. 앱 루트는 실제 CSS 뷰포트 전체를 차지하고, 글꼴·간격·패널 치수만 `documentElement.clientWidth/clientHeight`로 구한 디자인 단위에 비례한다. 변환된 고정 1700px 루트는 사용하지 않는다. 시스템 상태바·좌측 실차 뷰·시스템 GNB는 구현하지 않는다. 개발자 화면의 어두운 스크린샷과 레이어 수치를 기준으로 반영했다. Connect-L 조작 안내 `166:1209`, Connect-S 보조 리포트 `207:4516`을 참고했으며 예시 기록을 실제 데이터에 섞지 않는다.

Figma SVG 아이콘은 `web/assets/`에 보관하고 빌드 시 data URL로 포함한다. 임시 Figma 주소는 런타임에 사용하지 않는다. 도로·차량·보행자·실제 단서 장면은 요청대로 기존 Canvas로 그린다. Asta Sans 폰트 파일은 제공되지 않아 설치된 Asta Sans 또는 시스템 한글 폰트를 사용한다. 글꼴의 완전한 일치는 폰트 리소스 확보 후 확인해야 한다.

차량이 P가 아닐 때는 기존 **네이티브 차단막이 WebView보다 우선**한다. 웹에서 차량 확인/차단 화면을 표시했다고 알린 뒤에는 네이티브 차단막의 배경만 투명하게 하여 Figma 화면을 보여준다. 네이티브 터치 차단·포커스·WebView pause와 차량 기반 해제 조건은 유지된다. 웹이 준비되지 않거나 응답하지 않으면 불투명 네이티브 안내가 남는다. 차단 중 보이는 웹 버튼도 네이티브 차단막 아래에 있으므로 P 복귀 전에는 누를 수 없다. Figma 형태의 웹 일시정지 팝업과 이어하기 버튼은 P 복귀 후에도 유지된다.

## 실제 기록과 미확정 지표

세션 시간 `run.t`는 일시정지·탭 비활성 시간을 제외한다. 약 0.1초 간격으로 속도(km/h), 브레이크, 조향, 방향지시등, 시뮬레이션 좌표를 기록한다. 신호 전환, 브레이크 누름/해제, 단서, 보행자 출현, 우회전, 횡단보도 진입, 완전 정지, 종료 이벤트를 기록한다. 그래프는 실제 속도와 별도의 정규화 조작 띠를 표시한다. 시안처럼 충돌 시 속도를 임의로 0으로 만들지 않는다.

- **안전 점수:** 코드에 수치 산식이 없다. 시안의 86/42와 70점 기준을 실제 점수로 사용하지 않으며 `미확정`으로 표시한다. 기존 급제동 횟수는 유지하지만 점수로 환산하지 않는다.
- **반응 시간:** `cueAt`은 주행거리 15.5 m에서 보행자 이동을 시작하는 시뮬레이션 이벤트다. 실제 화면에서 단서가 보인 첫 순간과 동일하다는 근거가 없다. 브레이크 입력·감속·보행자 출현 중 어떤 반응을 종료 기준으로 삼을지도 미정이다. `미확정`으로 표시하고 실제 이벤트 시간과 당시 속도·브레이크 상태를 리포트에 표시한다.
- **정지 위치:** 실제 속도 0 도달 시각과 좌표/방향/주행거리는 기록한다. 기존 판정용 `crossEdge`는 횡단보도 진입 기준이며 공식 정지선으로 확정할 수 없다. 차량 중심·앞범퍼 등 측정 기준도 없다. 정지 횟수 또는 `정지 없음`을 표시하며 임의의 정지선 거리(m)를 만들지 않는다.
- **진입 속도:** 기존 `run.x >= crossEdge`를 처음 만족할 때 기록한 실제 시뮬레이션 속도. 진입 전 종료는 `미진입`이다.
- **단서 후 감속:** 단서 이후 샘플 중 당시 단서 속도보다 0.1 km/h 이상 낮아진 기록의 유무를 표시한다. 새 점수·합격 기준이 아닌 로그 요약이다. 공식 감속 판정 범위와 허용 오차는 미확정이다.
- **기존 성공/실패:** 차량과 보행자의 실제 경로를 현재~0.6초 범위에서 검사한다. 기존 전방 범위 (-0.9, 2.5 m), 측방 1.15 m, 횡단보도 진입 속도 4.2 m/s 초과 시 `fast` 등 기존 임계값은 변경하지 않았다. `waited`는 0.4 m/s 미만의 기존 대기 판정이다. 새 완전 정지는 속도 0을 별도로 기록한다. 이 값들은 코드의 기존 게임 규칙이며 Figma가 확정한 안전 기준은 아니다.

## 다음 시나리오

별도 시나리오 선택 화면, 시나리오 B 데이터, 목적 URL은 기존 코드에 없다. 기존 재주행은 `attempt++`로 시나리오 A의 보행자 유무(홀수 회차에는 없음), 차종, 강우량 등을 바꾼다. 이를 새 시나리오 목적지로 해석하지 않았다. `다음 시나리오`·`다른 시나리오`는 목적지 미정 문구와 비활성 버튼으로 남겼다. 실패의 처음으로는 차량 확인, 재주행·다시 도전은 기존 재시작 경로로 연결한다.

## 검증

- `node tests/drive.cjs`: 기존 물리·판정·제동 회귀 검사.
- `node tests/input.cjs`: 차량 READ 입력 중재, code 없는 키 이벤트, Space/조향/신호·초기화·안전 제한 검사.
- `node tests/ui.cjs`: 실제 번들에서 11개 화면, 실제 성공·실패 플레이, 세션 리포트, P 복귀 후 수동 재개, 기어 불명·UX 제한, 에셋 로드, 1700×1184/850×592/1280×800 경계 검사. 결과/PNG는 `android/app/build/ui-report/`.
- `node tests/scene.cjs`: Canvas 렌더러 실행·해상도 변경·초기화 검사. 비교할 이전 렌더러 파일을 넘기지 않았으므로 전후 픽셀 동등성까지 검증한 것은 아니다.
- `node tests/webview-smoke.cjs`: 설치된 Pleos API34 WebView에서 code 없는 CDP 키 유지·해제, Space 감속/복귀, Q/E, 조향, 주차 차단·명시적 재개 검사. **차량 입력은 주입한 READ 테스트 스트림**이다.
- 기존 `tests/keyboard-pleos.cjs`의 ADB `--longpress` 검사는 이 에뮬레이터에서 ArrowUp 입력 유지 시간이 짧아 throttle > 0.3 조건을 만족하지 못했다. 실제 키 전달은 관측했지만 이 테스트 전체는 통과하지 않았다. 지속 키 입력 검사는 별도 WebView smoke에서 확인했다. Windows 물리 키보드 검증은 별도다.
- SDK 초기 P단/핸들/브레이크/방향지시등 수신은 관측했다. 그러나 Virtual Console의 `gear.bridge_ready=false`, `controls.dds_ready.all=false`로 실제 기어·조향·페달 변경의 종단 검증은 미완료다. 테스트 주입 성공을 실제 SDK 신호 변경 성공으로 보고하지 않는다.
- Android: `gradlew.bat :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :app:lintDebug --offline`. Kotlin 단위 테스트 소스는 없어 `testDebugUnitTest NO-SOURCE`. 기존 SDK deprecated 경고와 Lint 경고는 남아 있다. 릴리스 APK는 별도 서명 설정이 없으면 unsigned다.

교통사고 데이터 수집 메모를 근거로 외부 저장·전송 기능을 추가하지 않았다. 플레이 기록은 현재 WebView 세션 안에서만 유지한다.

## 최종 실행 결과

| 검사 | 결과 |
|---|---|
| `drive.cjs`, `input.cjs`, `ui.cjs`, `scene.cjs` | 통과 |
| 설치 Pleos WebView 지속 키 입력·주차 재개 smoke | 통과, 주입 READ 스트림 |
| Debug / unsigned Release 빌드 | 통과 |
| Android Lint | 오류 0, 기존 경고 5 |
| Kotlin 단위 테스트 | `NO-SOURCE` |
| 기존 ADB ArrowUp longpress 전체 검사 | 실패, 짧은 유지 시간에서 테스트 임계값 미충족 |
| 실제 차량 신호 변경 종단 검사 | DDS/Virtual Console 연결 미준비로 미완료 |
| APK 내부 HTML | Debug·Release 모두 `dist/index.html`과 SHA-256 일치. 현재 번들 크기는 아래 뷰포트 수정 검증 참고 |

APK: `android/app/build/outputs/apk/debug/app-debug.apk`, `android/app/build/outputs/apk/release/app-release-unsigned.apk`.

## 설치 APK의 리포트 잘림·휠 이동 수정

Pleos 에뮬레이터에서 설치된 Debug APK의 WebView에 직접 연결했다. 브라우저의 viewport emulation이나 임시 CSS 주입 없이 수정 전 APK와 수정 후 재설치 APK를 비교했다.

| CSS px 실측 | 수정 전 | 수정 후 |
|---|---:|---:|
| 실제 뷰포트 (`documentElement.clientWidth/Height`) | 1224 × 880 | 1224 × 880 |
| `innerWidth/Height` | 1343 × 966 | 1224 × 880 |
| 문서 스크롤 범위 | 1343 × 966 | 1224 × 880 |
| 루트 표시 크기 (`getBoundingClientRect`) | 1462 × 1018.24 | 1224 × 880 |
| 루트 시작 좌표 | -119, -69.12 | 0, 0 |
| 휠 상하 이동 시 visual viewport의 세로 오프셋 | 0 ↔ 85.82 | 항상 0 |

원인은 고정 크기 루트에 transform을 적용한 뒤 overflow를 포함하는 `innerWidth/Height`를 축소 계산에 사용한 구조다. `body`만 숨겨도 문서/visual viewport의 초과 범위가 남았다.

- `html/body`를 실제 화면 크기에 고정하고 초과 범위·overscroll을 차단했다. `main`은 transform 없이 실제 뷰포트를 채운다.
- 디자인 px 수치를 디자인 단위 `rem`으로 옮겼으며, 실제 CSS viewport 크기로 단위를 계산한다. Android의 텍스트 자동 확대도 끄고 SVG의 intrinsic 치수를 유지한 채 표시 배율을 적용한다.
- 상세 리포트의 양쪽 패널을 제한된 Grid/Flex 높이에 배치했다. 제목·그래프·오른쪽 요약·하단 버튼은 첫 화면에서 보인다.
- `.timeline` 전체 대신 `#events` 목록만 스크롤한다. 목록 제목과 하단 버튼은 고정되며 목록 끝에서도 상위 스크롤로 전달되지 않는다. 새 리포트의 목록은 맨 위에서 시작한다.
- 그래프 Canvas의 픽셀은 존재하지만 실제 WebView 합성 화면에서 보이지 않는 경우도 확인했다. 정적인 리포트 그래프는 같은 Canvas의 실제 픽셀을 로컬 PNG data URL로 표시해 첫 표시와 목록 스크롤 후에도 보이게 했다. 주행 Canvas 렌더러는 그대로 사용한다.

`node tests/webview-layout.cjs --before`로 수정 전 측정/캡처, `node tests/webview-layout.cjs`로 수정 후 검사/캡처를 남긴다. 출력은 `android/app/build/layout-report/`의 `before.json`, `after.json`, `before-failure-report.png`, `after-failure-report.png`다. 긴 목록을 확인하기 위한 테스트 행 60개는 검사 후 제거한다. 실제 측정에서 목록만 700.36 CSS px 이동했고 루트·버튼·window/visual viewport는 이동하지 않았다. 차량 확인(`checking`), 브리핑(`intro`), 주행(`play`)에서도 휠 후 전체 위치가 고정됨을 확인했다.

뷰포트 수정 당시 `assembleDebug`, `assembleRelease`, `lintDebug` 성공. `ui.cjs`, `drive.cjs`, `input.cjs`, 설치 APK의 `webview-layout.cjs` 통과. Lint 오류 0, 기존 경고 5. 당시 웹 번들은 456,647 bytes다.

## Space 브레이크 유지 수정

사용 입력은 Space 길게 누름으로 확인했다. 설치된 기존 APK에서 정상적인 연속 Space는 정지까지 유지됐지만, 포커스 해제 이벤트 뒤 반복 keydown을 보내면 입력이 복구되지 않는 경로를 재현했다. 초기 브레이크가 약 0.68까지 들어온 뒤 0으로 떨어졌고 HUD가 꺼졌으며 속도는 약 19.68 km/h로 남았다. 기존 KeyboardAdapter가 blur에서 held 상태를 비운 뒤 `event.repeat`를 모두 무시한 것이 원인이다. 이 검사는 CDP 키 이벤트와 주입한 blur 이벤트로 수행했으며 Windows 물리 키보드 자체를 검사한 것은 아니다.

- 조향·가속·브레이크처럼 누르는 동안 동작하는 키는 입력이 다시 허용된 상태에서 반복 keydown으로 held 상태를 복구한다. Q/E/W 토글 입력의 반복 방지는 유지한다.
- blur·탭 비활성·P단/UX 차단 시 입력을 비우는 동작은 유지한다. P단 복귀 후 명시적 재개 전에는 반복 Space도 주행을 재개하지 않는다.
- 키를 놓으면 로컬 브레이크 입력은 즉시 0이 된다. 기존 Drive의 제동력 완화와 기본 속도 복귀는 그대로 적용한다. 키 유지 시간에 따라 브레이크가 0.5에서 1로 올라가는 동작도 유지한다.
- 차량 READ 입력이 제공되더라도 로컬 브레이크를 무시하지 않는다. 키보드·터치·게임패드·차량 중 가장 강한 제동을 적용하고, 제동 중에는 가속 입력을 억제한다. 차량의 더 강한 제동을 약한 로컬 입력으로 낮추지 않는다. 화면 브레이크 버튼은 READ 상태에서도 사용할 수 있다.

`node tests/webview-brake.cjs --before` / `node tests/webview-brake.cjs`로 설치 APK에 CDP 키·터치 이벤트를 보내 검사한다. SDK idle false와 주차 메시지는 테스트 주입이며 실제 차량 신호 변경 검증과 구분한다. 결과는 `android/app/build/brake-report/`에 보관한다.

최종 설치 APK 검사: Space 정상 유지, blur 후 반복 키 복구, 터치 유지(READ/NONE), 매 50ms SDK idle 업데이트 중 유지, 각 경우 20 → 0 km/h 완전 정지, 해제 후 HUD/입력 해제와 점진적 속도 복귀, P단 차단·명시적 재개 조건 통과. `input.cjs`에 동일 회귀 검사를 추가했고 `input.cjs`, `drive.cjs`, `ui.cjs`도 통과했다. Debug / unsigned Release 빌드와 Lint 성공(오류 0, 기존 경고 5). 최신 웹 번들은 457,109 bytes다.
