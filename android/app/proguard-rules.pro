# WebView에 노출하는 JavaScript 인터페이스(PleosHost)는 이름이 바뀌면 안 됩니다.
-keepclassmembers class com.rainyturn.game.PleosHostInterface {
    @android.webkit.JavascriptInterface <methods>;
}

# Pleos Vehicle SDK는 그대로 둡니다. 내부에서 리플렉션(kotlin-reflect), Gson, AIDL로
# 차량 서비스와 통신하므로, 실차·Pleos 에뮬레이터에서 검증하기 전까지는 축소하지 않습니다.
# 난독화되는 것은 com.rainyturn.game(우리 코드)뿐입니다.
-keep class ai.pleos.playground.** { *; }
-keep interface ai.pleos.playground.** { *; }
-dontwarn ai.pleos.playground.**

# CarUxRestrictionsManager(android.car)는 기기에 있는 라이브러리라 APK에 들어가지 않습니다.
-dontwarn android.car.**

# 크래시 로그를 원래 줄 번호로 되돌릴 수 있게 합니다(mapping.txt는 커밋하지 말고 팀이 보관).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
