# KUE

Capture a visual issue without leaving your iOS or Android app: take a
screenshot, crop it, add a memo, and submit it through your own callback or KUE Cloud.

This repository contains the MIT-licensed SDK and setup CLI only. KUE Cloud is a
separately operated service; its server code, configuration and credentials are
not part of this repository.

KUE shows its screens in Japanese or English, following the device's preferred
languages; `locale` fixes the display language.

The finding screen offers Add finding and Create Issue. Create Issue sends the
current finding, or confirms a title for it together with the saved findings. A
tap always captures; when the draft is full or its send result is unconfirmed,
the new finding goes alone and Saved findings shows the draft. The long-press
menu lists only what a tap cannot do, each item named beside its button.
The Expo `KueProps` requires `cloud` or `onSubmit`, and `submitLabel` with a custom handler.

Optional silent native screen recording and mixed video/image submission require
an active Indie workspace, a recording-capable build and Cloud with video
admission enabled. Free keeps a visible locked action.
During recording, tap the red-square KUE button to stop and review locally.
For Expo apps, the CLI resolves default `auto` recording inclusion from the
workspace plan, supports an explicit `off`, and saves deterministic build settings.
This selection does not enable recording or grant runtime entitlement by itself.
For a custom wrapper, the CLI's `--skip-integration` manages these
settings and dependencies without reading or editing JSX. Build and store
distribution remain part of the host application's workflow.

## Documentation

- [English](https://kue.ischca.dev/en/docs) / [日本語](https://kue.ischca.dev/docs)
- Markdown sources: [English](docs/user/en.md) / [日本語](docs/user/ja.md)

When changing user-visible behavior, review and update both documentation languages along
with affected package READMEs and release notes. If no documentation change is
needed, explain why in the pull request. Keep unreleased behavior distinct from
published SDK/CLI and Cloud features.

## Packages

| Integration | Installation and API reference | Distribution |
| --- | --- | --- |
| Expo SDK 54–57 | [@kue-qa/react-native](packages/react-native/README.md), [kue-qa setup CLI](packages/cli/README.md) | npm |
| iOS 15+, SwiftUI/UIKit | [Kue / optional KueRecorder](packages/ios/README.md) | Swift Package tag `v0.6.0`; release ZIP for local CocoaPods |
| Android API 26+, Views/Compose | [KUE Android](packages/android/README.md) | [Maven ZIP release](https://github.com/Ischca/kue/releases/tag/v0.6.0) |
| Flutter 3.32+, Dart 3.8+ | [kue_qa](packages/flutter/README.md), [optional recorder](packages/flutter-recorder/README.md) | [pub.dev core](https://pub.dev/packages/kue_qa/versions/0.6.0), [recorder](https://pub.dev/packages/kue_qa_recorder/versions/0.6.0) |
| React Native 0.86.2 / React 19.2.3, New Architecture | [@kue-qa/react-native-bare](packages/react-native-bare/README.md), [optional recorder](packages/react-native-bare-recorder/README.md) | npm |

The CLI requires Node.js 22.13 or newer and configures Expo applications.
Other integrations use their platform's dependency tools. KUE is disabled by
default in Release. Web capture is not supported. Do not install duplicate native
core copies when using the Flutter or Expo-free React Native packages.

## Release status

SDKs and CLI version `0.6.0` are available. Expo, Expo-free React Native and CLI
packages are distributed on npm; Flutter core and recorder are on pub.dev. Native
iOS uses the `v0.6.0` Swift Package tag or release ZIP; native Android uses the
[Maven ZIP release](https://github.com/Ischca/kue/releases/tag/v0.6.0).
The production Cloud is hosted at [kue.ischca.dev](https://kue.ischca.dev/).
Cloud requires the KUE QA GitHub App on the destination repository. SDK usage
with your own callback does not require the App or a Cloud account. Recording
requires Cloud feature entitlement even with local saving. Check the
[pricing page](https://kue.ischca.dev/en/pricing) for Cloud sales availability.

## Cloud plans

A workspace covers one GitHub personal account or organization. The connecting
user must own that account or organization and have repository administrator
permission. The first connecting user becomes its KUE workspace owner. Separate
GitHub owners and separate clients' work require separate subscriptions.

| Per workspace | Free | Indie |
| --- | --- | --- |
| Monthly price | US$0 | US$12, tax included |
| Active projects | 1 | Unlimited |
| Reports per UTC calendar month | 100 | 5,000 |
| Image storage | 100 MB | 10 GB |
| Image retention from acceptance | 30 days | 365 days |

Usage is shared across the workspace. There are no per-tester or per-device fees.
New submissions stop at the limits; there are no automatic overage charges.
Accepted reports count even if Issue delivery fails; deletion does not restore quota.
Indie renews monthly. Its billing period is separate from the UTC monthly quota reset.
Manage cancellation through the dashboard before renewal; access continues until
the paid period ends. Deleting a project or uninstalling the SDK does not cancel billing.

Production Cloud retains multiple Free connections but restricts repository
switching for 24 hours from the first accepted report to a new destination.
Switching requires explicit dashboard confirmation after expiry;
connecting an app or checking its key will not switch the destination. See the
documentation for the complete policy.

## Install in Expo

```sh
# From the Expo app or workspace root, once your repository has access to the GitHub App:
npx kue-qa init
```

The default server is `https://kue.ischca.dev`. Use `--server URL` for staging or
local development.
One Expo app in the workspace is selected automatically. With multiple apps,
use `npx kue-qa init --app apps/mobile`; no app is selected implicitly.
To use the current published version, run `npx kue-qa@latest init`. The CLI installs
the SDK at the same exact version.
No Cloud account is needed to use the SDK with your own `onSubmit` callback and `submitLabel`.
For other platforms, follow the [Documentation](https://kue.ischca.dev/en/docs).
See the [Expo SDK installation and API documentation](packages/react-native/README.md) for
manual integration and the [CLI documentation](packages/cli/README.md) for tarball setup.
Upgrades use normal package versions and your app's lockfile.

Repeating `init` with unchanged managed configuration, integration, and installed
dependencies does not restart approval, run the package manager, or rewrite files.
The CLI still reads the current plan when recording is set to `auto`; `off` skips
that read. Use `--reconnect` to explicitly reconnect. See the
[CLI documentation](packages/cli/README.md#idempotent-setup) for update,
dependency, and configuration rules.

The floating button defaults to a viewfinder design. Use
`<Kue cloud={cloud} buttonDesign="mascot" />` to select the bundled character with the same gestures.

## Data handling

Review screenshots before sending and crop out personal information or secrets.
The optional offline queue stores reports inside the host app's private documents
directory and follows its backup policy; it is not separately encrypted.
Cloud image links grant access to anyone who has the link, independently of GitHub
repository permissions. Expired images cannot be restored. Upgrading does not extend
existing Free images; Indie images expire within 30 days after the subscription ends,
without extending the original deadline. Image expiry does not delete report metadata
or GitHub Issues. CDN, browser, and GitHub caches may delay revocation.
A delivery-disabled placeholder containing no original image may remain to prevent republication.

Deleting a workspace schedules its images, reports, and workspace information for
removal; active subscriptions must end first. GitHub Issues and Stripe invoices remain.
Current-month usage and a pseudonymized owner-matching record remain until scheduled
cleanup from the following month to prevent quota resets. See the
[Documentation](https://kue.ischca.dev/en/docs) for account removal, ownership transfers,
receipt tokens, retry behavior, and optional trigger limitations.

## Development

Use Node.js 24 and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
```

CI runs type checks, SDK/CLI tests, builds and package-content previews. It has no
publication or deployment step. See [CHANGELOG.md](CHANGELOG.md) for release
history and [LICENSE](LICENSE) for the MIT license.
