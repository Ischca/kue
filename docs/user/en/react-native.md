# React Native without Expo

Uses native floating controls, crop/memo editing, image/video group confirmation, additional triggers, Cloud submission and a durable single-image outbox. This installation is separate from the Expo package.

## React Native without Expo requirements

The supported baseline is React Native 0.86.2 / React 19.2.3 with New Architecture, iOS 15.1+ or Android API 26+, JDK 17 and compile SDK 36. Other React Native versions, the old architecture, web, macOS and Windows are not supported. The package includes its native core; no Expo dependency, separate Kue pod/Gradle project or private source checkout is required.

## Install the React Native core

```sh
npm install @kue-qa/react-native-bare@0.6.0
cd ios
bundle exec pod install
```

Run the pod commands on macOS for iOS, then rebuild with the application's usual Xcode/Gradle or React Native CLI command. Autolinking and Codegen register the modules. Do not use the Expo setup CLI for this package. Debug normally uses Metro; Release contains an embedded JavaScript bundle. An independently launchable Debug application needs an embedded bundle and the corresponding app delegate configuration.

## Mount Kue and capture

Mount one Kue near the application root. Replace the fake origin and key with the project's connection settings. This example explicitly enables the SDK in Release as well.

```tsx
import { Kue } from "@kue-qa/react-native-bare";

export function Feedback() {
  return (
    <Kue
      enabled={true}
      locale="en"
      cloud={{
        apiBaseUrl: "https://feedback.example.com",
        projectKey: "pk_REPLACE_WITH_PROJECT_KEY",
      }}
    />
  );
}
```

After the host is mounted, an application action can open the native screenshot editor:

```tsx
import { reportIssue } from "@kue-qa/react-native-bare";

await reportIssue({
  memo: "Check this flow",
  context: { route: "/products/yirgacheffe" },
});
```

Opening the editor does not submit a report. reportIssue returns `Promise<void>` after capture and presentation; later submission, queueing, cancellation and finding addition are reported by onOutcome. Capture/background cancellation rejects the promise. The default capture uses the native window; secure content and native video/surface views may be unavailable.

For local saving, supply a stable onSubmit callback and a nonempty submitLabel instead of a Cloud destination. onSubmit takes precedence if both are supplied. A group requires its own onSubmitGroup callback or Cloud destination; individual callbacks are not a fallback. Callback media URIs remain valid only while the returned promise is pending. Upload or await copyKueMediaFile before resolving; retained copies are application-owned. See the package API reference for copy removal, custom capture adapters and typed outcomes.

enabled defaults to __DEV__, recording to auto and the floating button to true. Shake, system screenshot triggers and offlineQueue default to false. Locale follows native preferred languages unless set to ja/en. Callback timeout defaults to 30000 ms. Cloud, handler identities, capture, custom triggers and queue settings are fixed while mounted; use stable callbacks and remount with a new React key to change them.

## Optional React Native recording

```sh
npm install @kue-qa/react-native-bare-recorder@0.6.0
cd ios
bundle exec pod install
```

Rebuild both native applications. No recorder import or JavaScript initialization is required. Recording requires a group destination, Cloud entitlement/admission and OS consent, including local saving. Output is silent H.264 MP4, at most 60 seconds / 20 MiB; the user previews it, enters a required memo and explicitly confirms the group. No microphone/camera permission or automatic video upload is used.

## Disable or remove React Native KUE

enabled={false} cancels the current session. To remove recording code and Android service permissions, remove the optional package, reinstall pods and rebuild:

```sh
npm uninstall @kue-qa/react-native-bare-recorder
cd ios
bundle exec pod install
```

recording="off" only disables recording at runtime. Remove Kue and the core dependency to remove the SDK. Persisted pending screenshots survive unmounting, so explicitly discard them before removal if required. The optional Cloud screenshot outbox is destination-bound; groups and videos are not queued. HTTP 202 means acceptance, not completed Issue creation.

## API reference

[React Native API reference](https://github.com/Ischca/kue/blob/v0.6.0/packages/react-native-bare/README.md)
