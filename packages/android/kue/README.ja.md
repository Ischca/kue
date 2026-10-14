# KUE Android SDK

ネイティブAndroid向けのスクリーンショット報告、指摘のグループ送信、任意の画面録画、スクリーンショット送信待ちキューを提供します。ExpoやReact Nativeへの依存はありません。0.6.0は[GitHub Release](https://github.com/Ischca/kue/releases/tag/v0.6.0)のMavenリポジトリZIPで配布します。Maven Centralの配布座標ではありません。[English API reference](./README.md)

## 要件

- Android 8／API 26以上、フォアグラウンドのActivity、Kotlin／JVM 17。
- サンプルのビルド環境はcompile／target SDK 36、AGP 8.13.2、Kotlin 2.1.20、Gradle 8.13です。
- ViewsとComposeの両方で同じActivity用コントローラーを使用します。SDKの編集画面は独自のライトテーマを使用し、ホストアプリのテーマを変更しません。

## 導入

アプリのルートディレクトリでZIPとチェックサムを取得し、検証後に解凍します。

```sh
curl --fail --location --output kue-android-maven-0.6.0.zip \
  https://github.com/Ischca/kue/releases/download/v0.6.0/kue-android-maven-0.6.0.zip
curl --fail --location --output kue-android-maven-0.6.0.zip.sha256 \
  https://github.com/Ischca/kue/releases/download/v0.6.0/kue-android-maven-0.6.0.zip.sha256
shasum -a 256 -c kue-android-maven-0.6.0.zip.sha256
unzip kue-android-maven-0.6.0.zip -d vendor/kue
```

ZIPにはAAR、POM、Gradleメタデータ、ソースJAR、MITライセンスが含まれます。`vendor/kue/android-maven`の内容をまとめて保持してください。AARだけをコピーすると推移的な依存関係を解決できません。SDKソースのcheckoutや公開者の認証情報は不要です。

`settings.gradle.kts`にファイルリポジトリを追加します。

```kotlin
dependencyResolutionManagement {
    repositories {
        maven {
            url = uri("vendor/kue/android-maven")
            content { includeGroup("dev.kue.qa") }
        }
        google()
        mavenCentral()
    }
}
```

アプリモジュールの`build.gradle.kts`に依存を追加します。

```kotlin
dependencies {
    implementation("dev.kue.qa:kue-android:0.6.0")
    // Add only when screen recording must be included in the binary.
    implementation("dev.kue.qa:kue-android-recorder:0.6.0")
}
```

Gradleを同期してアプリを再ビルドします。POMは標準リポジトリからOkHttpとKotlinを解決します。録画を含めない場合はrecorderの依存を省略してください。recorderは同じ版のcoreを推移的に解決し、録画用Activity、foreground service、権限、R8ルールを追加します。

coreはInternetとAndroid 14のスクリーンショット検知用権限を宣言します。写真ライブラリやマイクへのアクセスは要求しません。recorderの依存を削除して再ビルドすると録画用のネイティブ機能と権限を除外できます。実行時の`recording = OFF`だけではバイナリから除外されません。

## Views／Composeへの取り付け

メインスレッドで、`setContentView`またはComposeの`setContent`の後に取り付けます。Activityごとに1つのコントローラーを使用します。Activity破棄時にはSDKが解除します。

```kotlin
val controller = Kue.install(activity, KueConfig(
    locale = KueLocale.JA,
    submitLabel = "Save",
    onSubmit = { report, complete ->
        // Persist report.screenshotBytes and fields using application-owned storage.
        complete(Result.success(Unit))
    },
    onSubmitGroup = { group, complete ->
        // One explicit group submission, never one callback per finding.
        complete(Result.success(Unit))
    },
))
controller.reportIssue(memo = "Check this flow")
```

デバッグ可能でないアプリでは既定で無効です。Releaseビルドでも使用する場合は`KueConfig`に`enabled = true`を明示してください。ローカル保存コールバックには表示ラベルが必要で、処理完了を1回だけ返します。重い保存処理はアプリのワーカーへ移します。Cloudとローカル保存を併用する場合、該当するローカルコールバックが優先されます。

Cloudに送信する場合はダッシュボードで取得したプロジェクトキーを設定します。

```kotlin
val controller = Kue.install(activity, KueConfig(
    cloud = KueCloudConfig("https://YOUR-KUE-HOST", "pk_REPLACE_WITH_PROJECT_KEY"),
    offlineQueue = true,
    onReceipt = { receipt -> /* Show receipt.status; never log receipt.receiptToken. */ },
    onQueued = { clientReportId -> /* Persisted locally, not accepted by Cloud. */ },
))
```

## 録画、再送、削除

録画は任意のrecorder依存、CloudのIndie権限、録画サービスの可用性、グループ送信先、毎回のOS同意を必要とします。無音H.264／MP4を最大60秒／20MiBの範囲で記録します。録画中の赤い停止ボタンを押すと停止し、再生・必須メモ・指摘への追加を行えます。動画は明示的に確認したグループとして送信し、単独送信へ自動的に切り替えません。

`offlineQueue`はCloudへの単独スクリーンショット送信にのみ適用し、既定では無効です。最大10件／50MiB、保存期間7日です。動画・グループは永続キューへ保存しません。自動再送はフォアグラウンドかつ未操作時に限られ、送信先を変更しても古い送信待ちを新しい送信先へ移しません。202応答は受付を示し、GitHub Issueの作成完了ではありません。受領情報による状態確認は明示的に行います。

アップグレード時は同じ版のMavenリポジトリを解凍し、coreとrecorderの依存版をそろえます。取り除く場合はコントローラーを解除し、依存を削除して再ビルドします。アプリの依存がなくなった後にvendoredリポジトリを削除できます。coreのソースモジュールとAARを重複して導入しないでください。

API、上限、コールバック、トリガーの詳細は[English API reference](./README.md)、共有Cloud仕様は[ドキュメント](https://kue.ischca.dev/docs)を参照してください。OS同意、スクリーンショット検知、レイアウト、読み上げの挙動は端末環境によって異なるため、導入先アプリで確認してください。
