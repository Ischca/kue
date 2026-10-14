plugins { id("com.android.library"); id("org.jetbrains.kotlin.android"); id("com.facebook.react") }
android {
    namespace = "dev.ischca.kue"
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
react { libraryName = "KueBareSpec"; codegenJavaPackageName = "dev.kue.qa.reactnative" }
dependencies {
    implementation("com.facebook.react:react-android")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
