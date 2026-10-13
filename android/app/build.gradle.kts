plugins {
    id("com.android.application")
}

// Segundo for Android: a Trusted Web Activity around https://segundo.world/app. The web app does everything; this
// package gives it a launcher icon, a splash screen and a full-screen window (no URL bar once the site's
// /.well-known/assetlinks.json names this package and the release certificate).
android {
    namespace = "world.segundo.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "world.segundo.app"
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            storeFile = file("../../keys/segundo-release.jks")
            storePassword = System.getenv("SEGUNDO_KEYSTORE_PASSWORD") ?: ""
            keyAlias = "segundo"
            keyPassword = System.getenv("SEGUNDO_KEYSTORE_PASSWORD") ?: ""
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/versions/**", "META-INF/LICENSE*", "META-INF/NOTICE*", "kotlin/**", "DebugProbesKt.bin")
    }
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
