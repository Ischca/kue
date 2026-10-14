import java.io.File

plugins { id("com.android.library"); id("org.jetbrains.kotlin.android"); id("maven-publish") }
group = "dev.kue.qa"
version = "0.6.0"
tasks.matching { it.name.endsWith("ToMavenLocal") }.configureEach { enabled = false }
android {
    namespace = "dev.ischca.kue"
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    publishing { singleVariant("release") { withSourcesJar() } }
}
// File repository only. No implicit ~/.m2 or remote target is configured.
providers.gradleProperty("kueLocalRepository").orNull?.let { destination ->
    val directory = file(destination)
    require(File(destination).isAbsolute && !destination.contains("://")) { "kueLocalRepository must be an absolute local directory" }
    publishing {
        publications {
            register<MavenPublication>("release") {
                artifactId = "kue-android"
                pom { name.set("KUE Android"); description.set("Native Android screenshot, findings, outbox and trigger SDK")
                    url.set("https://github.com/Ischca/kue")
                    licenses { license { name.set("MIT"); url.set("https://opensource.org/license/mit") } } }
                afterEvaluate { from(components["release"]) }
            }
        }
        repositories { maven { name = "KueLocal"; url = uri(directory) } }
    }
}
dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
