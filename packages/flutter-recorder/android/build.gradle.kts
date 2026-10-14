plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }
group = "dev.kue.qa.flutter.recorder"
version = "0.6.0"
android {
    namespace = "dev.ischca.kue.recorder"
    compileSdk = 36
    defaultConfig { minSdk = 26; consumerProguardFiles("consumer-rules.pro") }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation(project(":kue_qa")) }
