# Native Android

Provides screenshot editing, saved-finding group confirmation, optional recording, Cloud submission, a durable single-image outbox, and additional triggers. The corresponding local callback takes precedence over Cloud submission.

## Native Android installation

Requirements: Android 8/API 26 or later, a foreground Activity and Kotlin/JVM 17. The reference consumers use compile/target SDK 36, AGP 8.13.2 and Kotlin 2.1.20. Views and Compose use the same native controller. Install core and the optional recorder from Maven Central. No SDK source checkout, vendor ZIP or publisher credentials are required.

Include `google()` and `mavenCentral()` in `settings.gradle.kts`:

```kotlin
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
```

Add dependencies to the application module and sync Gradle. Omit the recorder dependency to exclude native recording:

```kotlin
dependencies {
    implementation("io.github.ischca.kue:kue-android:0.6.0")
    // Optional: omit this dependency to exclude native screen recording.
    implementation("io.github.ischca.kue:kue-android-recorder:0.6.0")
}
```

The POM resolves Kotlin and OkHttp from standard repositories. The recorder resolves the matching core transitively, includes its resources, non-exported consent Activity/media-projection service, foreground-service permissions and R8 rules. The core adds Internet and screen-capture detection permissions. Neither artifact requests photo-library or microphone access. Remove the recorder dependency and rebuild to exclude its native pieces; runtime recording OFF alone does not remove them.

## Attach to Views

Install on the main thread after `setContentView`. Replace the fake key with the project's ingest key. KUE owns its floating control and detaches when the Activity is destroyed:

```kotlin
import android.app.Activity
import android.os.Bundle
import android.widget.TextView
import dev.ischca.kue.Kue
import dev.ischca.kue.KueCloudConfig
import dev.ischca.kue.KueConfig

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply { text = "Example" })
        Kue.install(this, KueConfig(
            enabled = true,
            cloud = KueCloudConfig("https://kue.ischca.dev", "pk_REPLACE_WITH_PROJECT_KEY"),
        ))
    }
}
```

## Attach to Compose

Install once in the Activity after `setContent`, rather than on each recomposition:

```kotlin
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import dev.ischca.kue.Kue
import dev.ischca.kue.KueCloudConfig
import dev.ischca.kue.KueConfig

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { Text("Example") }
        Kue.install(this, KueConfig(
            enabled = true,
            cloud = KueCloudConfig("https://kue.ischca.dev", "pk_REPLACE_WITH_PROJECT_KEY"),
        ))
    }
}
```

When `enabled` is omitted, KUE defaults to enabled only in debuggable applications. The examples explicitly enable it, including Release. Recording still requires the optional recorder, AUTO mode, Cloud Indie entitlement, service availability, a group destination and fresh OS consent. Recording is silent H.264/MP4, up to 60 seconds/20 MiB; videos only send through explicitly confirmed groups. Including the dependency never starts a recording or sends a report automatically.

## Upgrade and remove

Update core and recorder dependency versions together, sync Gradle and rebuild. When migrating from the existing GitHub Release ZIP coordinates under `dev.kue.qa`, replace the old dependencies with the Maven Central coordinates above. Remove the old local repository reference and source-module SDK dependencies; do not link duplicate SDK copies. Call `controller.uninstall()` to detach the running SDK. To remove KUE from the application, remove `Kue.install`, controller calls and unused imports from the application code, remove the dependencies and rebuild. Remove the vendor directory only after it is no longer referenced. Existing ZIP distribution and its coordinates remain available. No Maven publisher credentials or additional host Activity result/launch-mode integration are required.

## API reference

For local storage, configure `KueConfig.onSubmit(report, complete)` and a separate `onSubmitGroup(group, complete)` with an action label. Complete application-owned saving before calling `complete(Result.success(Unit))` once. Groups never fall back to separate single callbacks. Additional shake/OS screenshot triggers are explicitly enabled and do not read the photo library. `controller.reportIssue(memo, context)` returns `true` when a capture can start and `false` when disabled, unavailable or busy; it does not await submission. Review the required memo, crop and destination before explicit submission. See the API reference for `openSavedFindings()`, `recordScreen()`, `openOutbox()` and state notifications.

[API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/android/README.md)
