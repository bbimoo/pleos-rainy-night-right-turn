import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// 공모전 제출용 릴리스 서명. android/keystore.properties가 있을 때만 사용합니다.
// storeFile=..., storePassword=..., keyAlias=..., keyPassword=...
val keystoreFile = rootProject.file("keystore.properties")
val keystore = Properties().apply { if (keystoreFile.exists()) keystoreFile.inputStream().use(::load) }

android {
    namespace = "com.rainyturn.game"
    compileSdk = 35

    // CarUxRestrictionsManager(주행 규제) 사용
    useLibrary("android.car")

    defaultConfig {
        applicationId = "com.rainyturn.game"
        minSdk = 28 // 공모전 요구사항: API 28 이상
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // R8: 우리 코드는 축소·난독화하고, 쓰지 않는 리소스를 뺍니다. 보존 규칙은 proguard-rules.pro.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }

    // 웹 게임 번들(../../dist/index.html)을 assets/web/index.html로 넣습니다.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webGame"))
}

val webGameBundle = rootProject.file("../dist/index.html")

val buildWebGame by tasks.registering(Exec::class) {
    description = "Builds the WebView bundle from the current web sources."
    workingDir(rootProject.projectDir.parentFile)
    commandLine("node", "build.mjs")
    inputs.dir(rootProject.file("../web"))
    inputs.file(rootProject.file("../build.mjs"))
    outputs.file(webGameBundle)
}

val syncWebGame by tasks.registering(Copy::class) {
    dependsOn(buildWebGame)
    description = "Copies the built web game (dist/index.html) into the APK assets."
    doFirst {
        check(webGameBundle.exists()) {
            "웹 게임 번들이 없습니다. 레포 루트에서 `node build.mjs`를 먼저 실행하세요: $webGameBundle"
        }
    }
    from(webGameBundle)
    into(layout.buildDirectory.dir("generated/webGame/web"))
}

tasks.named("preBuild") { dependsOn(syncWebGame) }

dependencies {
    implementation(libs.pleos.vehicle)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.webkit)
}
