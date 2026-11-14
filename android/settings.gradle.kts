pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Pleos Connect SDK (Vehicle 등). 이 저장소에서는 ai.pleos.playground 그룹만 받고,
        // 그 그룹은 이 저장소에서만 받습니다. 다른 라이브러리 이름으로 가짜 패키지가 섞이는
        // 의존성 혼동(dependency confusion)을 막습니다.
        exclusiveContent {
            forRepository { maven("https://nexus-playground.pleos.ai/repository/maven-releases/") }
            filter { includeGroup("ai.pleos.playground") }
        }
    }
}

rootProject.name = "RainyNightRightTurn"
include(":app")
