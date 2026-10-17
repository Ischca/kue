# ネイティブAndroid

スクリーンショットの編集、保存した指摘をまとめて確認する機能、任意の録画、Cloudへの送信、オフラインキュー（画像1枚のレポートのみ）、追加のトリガーを提供します。ローカル保存のコールバックを指定した場合は、対応するCloud送信より優先されます。

## ネイティブAndroidの導入

Android 8／API 26以上、フォアグラウンドのActivity、Kotlin／JVM 17が必要です。参考アプリはcompile／target SDK 36、AGP 8.13.2、Kotlin 2.1.20を使っています。

ViewsとComposeは同じネイティブコントローラーを使います。

Maven Centralから本体と任意の録画モジュールを導入します。SDKのソースのチェックアウト、ZIPの配置、公開者の認証情報は不要です。

`settings.gradle.kts`のリポジトリに`google()`と`mavenCentral()`を含めます。

```kotlin
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
```

アプリモジュールに依存関係を追加し、Gradleを同期します。録画を含めない場合は、recorderの依存関係を追加しません。

```kotlin
dependencies {
    implementation("io.github.ischca.kue:kue-android:0.6.0")
    // Optional: omit this dependency to exclude native screen recording.
    implementation("io.github.ischca.kue:kue-android-recorder:0.6.0")
}
```

POMはKotlinとOkHttpを標準のリポジトリから取得します。recorderを追加すると、同じバージョンのcoreも依存関係として自動で取得されます。recorderにはリソース、録画の同意を求めるActivityとmedia-projection用のサービス（どちらもexportedなし）、フォアグラウンドサービスの権限、R8ルールが含まれます。

coreはInternet権限とスクリーンショット検知用の権限を追加します。写真ライブラリやマイクへのアクセスは要求しません。

録画用のネイティブ機能を除外するには、recorderの依存関係を削除して再ビルドします。実行時に録画をOFFにするだけでは除外されません。

## Viewsへの組み込み

メインスレッドで、`setContentView`の後に組み込みます。キーのプレースホルダーを、プロジェクトの送信キーに置き換えてください。フローティングボタンはSDKが管理し、Activityが破棄されたときに解除されます。

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

## Composeへの組み込み

Activityの`setContent`の後に1回だけ組み込みます。再コンポジションのたびには組み込みません。

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

`enabled`を省略した場合は、デバッグ可能なアプリでだけデフォルトで有効になります。この例では、Releaseを含めて明示的に有効にしています。

録画を使うには、次の条件をすべて満たす必要があります。recorderを追加していること、録画設定がAUTOであること、CloudでIndieプランを契約していること、Cloudで録画を提供していること、まとめ送信の送信先を設定していること、録画のたびにOSの許可を得ること。録画は最大60秒／20MiBの音声なしのH.264／MP4です。動画は、ユーザーが確認したグループとしてだけ送信されます。依存関係を追加しただけで、録画や送信が始まることはありません。

## アップグレードと削除

coreとrecorderの依存関係のバージョンをそろえ、Gradleを同期して再ビルドします。

これまでのGitHub ReleaseのZIP版（`dev.kue.qa`）から移行する場合は、古い依存関係の指定を、上記のMaven Centralの指定（`io.github.ischca.kue:…`）に置き換えます。古いローカルリポジトリへの参照と、SDKのソースモジュールへの依存関係は削除してください。同じSDKを二重にリンクしないでください。

実行中のSDKを解除するには、`controller.uninstall()`を呼びます。

SDKをアプリから削除する場合は、`Kue.install`、controllerの呼び出し、不要なimportをアプリのコードから削除し、依存関係も削除して再ビルドします。vendorディレクトリは、参照がなくなった後に削除できます。

これまでのZIP版とそのグループIDは引き続き使えます。Mavenの公開者の認証情報や、ホストActivityでの結果通知・launch modeの追加設定は不要です。

## APIリファレンス

ローカル保存は `KueConfig.onSubmit(report, complete)` で、グループの保存は別の `onSubmitGroup(group, complete)` で指定し、表示ラベルを設定します。アプリ側で保存を終えてから、`complete(Result.success(Unit))` を1回だけ呼びます。グループを1件ずつのコールバックに分けて送信することはありません。

シェイクとOSのスクリーンショットによる追加の検知は、有効にした場合だけ動作します。この検知は写真ライブラリを読み取りません。

`controller.reportIssue(memo, context)` は、キャプチャを開始できた場合に `true` を、無効・利用不可・操作中の場合に `false` を返します。送信の完了は待ちません。ユーザーが必須のメモ、範囲、保存先を確認してから送信します。

`openSavedFindings()`、`recordScreen()`、`openOutbox()` と状態の通知の詳細は、APIリファレンスを参照してください。

[API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/android/README.md)
