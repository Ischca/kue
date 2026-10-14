plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }
group = "dev.kue.qa.flutter"
version = "0.6.0"
android {
    namespace = "dev.ischca.kue"
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation("com.squareup.okhttp3:okhttp:4.12.0") }
