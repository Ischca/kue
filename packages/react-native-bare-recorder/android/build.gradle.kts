plugins { id("com.android.library"); id("org.jetbrains.kotlin.android"); id("com.facebook.react") }
android {
    namespace = "dev.ischca.kue.recorder"
    compileSdk = 36
    defaultConfig { minSdk = 26; consumerProguardFiles("consumer-rules.pro") }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
react { libraryName = "KueBareRecorderSpec"; codegenJavaPackageName = "dev.kue.qa.reactnative.recorder" }
dependencies {
    implementation("com.facebook.react:react-android")
    implementation(project(":kue-qa_react-native-bare"))
}
