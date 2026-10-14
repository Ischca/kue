import java.io.File

plugins { id("com.android.library"); id("org.jetbrains.kotlin.android"); id("maven-publish") }
group = "dev.kue.qa"
version = "0.6.0"
tasks.matching { it.name.endsWith("ToMavenLocal") }.configureEach { enabled = false }
android {
    namespace = "dev.ischca.kue.recorder"
    compileSdk = 36
    defaultConfig { minSdk = 26; consumerProguardFiles("consumer-rules.pro") }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    publishing { singleVariant("release") { withSourcesJar() } }
}
dependencies { api(project(":kue")) }
providers.gradleProperty("kueLocalRepository").orNull?.let { destination ->
    val directory = file(destination)
    require(File(destination).isAbsolute && !destination.contains("://")) { "kueLocalRepository must be an absolute local directory" }
    publishing {
        publications {
            register<MavenPublication>("release") {
                artifactId = "kue-android-recorder"
                pom { name.set("KUE Android recorder"); description.set("Optional MediaProjection provider for KUE Android")
                    url.set("https://github.com/Ischca/kue")
                    licenses { license { name.set("MIT"); url.set("https://opensource.org/license/mit") } } }
                afterEvaluate { from(components["release"]) }
            }
        }
        repositories { maven { name = "KueLocal"; url = uri(directory) } }
    }
}
