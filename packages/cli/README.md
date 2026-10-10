# KUE CLI

Connect an Expo SDK 54–57 app to KUE Cloud. Node 22.13+ is required.
With Xcode 27 and Expo SDK 57, use `expo@57.0.23` or later and enable
`expo-build-properties` `ios.enableSceneSupport` before regenerating iOS.

Documentation: [English](https://kue.ischca.dev/en/docs) / [日本語](https://kue.ischca.dev/docs).

```sh
npx kue-qa@0.4.0 init
```

Run from the Expo package or the monorepo workspace root. A single Expo app in
`pnpm-workspace.yaml` packages or `package.json` workspaces is selected automatically;
the pnpm definition takes precedence when both exist. Multiple apps are listed
without changing anything: select one with `npx kue-qa init --app apps/mobile`.
On first setup, the CLI detects your GitHub
remote, opens browser consent, installs the SDK/native dependencies, and adds KUE
to the default React component. It preserves loading returns and nested callbacks.
Review the diff. Unsupported component patterns fail without editing your root;
in that case add `<Kue cloud={...} />` manually. KUE is development-only by default.

Install the KUE QA GitHub App on the target repository. Connection requires the
personal repository owner or a GitHub organization owner, with repository
administrator permission. The repository's GitHub owner determines its workspace;
the first connecting user becomes its KUE workspace owner. Other organization
owners do not automatically gain access to an existing KUE workspace.

Free includes one active project and 100 reports per UTC calendar month per
workspace. Indie is US$12/month, tax included, for one GitHub personal account or
organization, with unlimited projects and 5,000 monthly reports. It is not a
per-tester or per-device license. Storage, retention, sales availability, and
contract terms are listed on the [pricing page](https://kue.ischca.dev/en/pricing).

The default server is `https://kue.ischca.dev`. To use staging or a local server,
pass `--server https://YOUR-KUE-HOST` (HTTP is allowed only for loopback addresses).
`--config project.json` uses the server in that file instead of the default.

`--dry-run` previews detection without writes or network. `--app` selects an Expo
package inside the invocation directory. `--root` and
`--repository` override detection. Existing connections require explicit
`--reconnect` to reauthorize or change the destination. `--no-open` prints the consent link.
`--skip-install` is for managed dependency workflows. `--config project.json`
accepts dashboard configuration instead of browser authorization. `--sdk sdk.tgz`
installs a locally packed SDK; yalc is not required.

`--root` is relative to the selected app; `--config` and `--sdk` remain relative to
the invocation directory. Installation, source edits and `.kue` target only the
selected app. Package-manager detection also reads ancestor `packageManager`
fields and lockfiles. Discovery skips links, hidden directories, `node_modules`,
`vendor`, `build`, `dist`, `coverage`, `ios` and `android`. Searches exceeding 2,000
directories stop without selecting a partial result; use `--app` in that case.
Run inside the app or use `--app` if no workspace definition exists.

`.kue/config.js` contains only a public create-only key and can be committed.
`.kue/backup-*.txt` contains the original app source and must remain local.
The CLI never stores GitHub user tokens or billing credentials in your app.

To update: install the desired `@kue-qa/react-native` version with your package
manager, or use the matching newer CLI. An unchanged `init` is a no-op; use
`--reconnect` to refresh the connection explicitly. There is no
automatic SDK update or runtime dependency on this CLI.

These instructions target version `0.4.0`; confirm it is available on npm before
installation. Pin setup with `npx kue-qa@0.4.0 init`; the CLI installs the SDK at its own
exact version, never a beta tag. SDK/CLI installation does not purchase a Cloud
subscription. The KUE workspace owner manages purchases and cancellation in the
[dashboard](https://kue.ischca.dev/en/app); rerunning or removing the CLI does not
change the subscription.

## Idempotent setup

CLI 0.3.4 reuses valid managed configuration, including the 0.3.3
format. When integration and installed dependencies match, ordinary `init` is a
no-op: no browser, network, package-manager execution, file writes or mtime changes.
This does not verify Cloud connectivity or whether a project key was revoked.

- A newer CLI updates only an older SDK; it never downgrades a newer installed SDK.
  Compatible existing native dependencies are preserved. Only missing declarations
  are added, using version ranges from the installed Expo package.
- Declared but missing or incompatible packages stop setup. Restore dependencies
  from your lockfile or explicitly review a dependency update first. `--skip-install`
  leaves dependency validation and installation entirely to the application.
- Use `--reconnect` to explicitly request browser approval again. Combine it with
  `--repository OWNER/REPO` or `--server URL` to change the connection. Ordinary runs
  ignore Git remote changes when a valid configuration already exists.
- `--config project.json` explicitly replaces configuration without browser approval;
  identical values are not rewritten. It cannot be combined with `--reconnect`,
  `--repository`, or `--server`.
- `.kue/setup.json` records the approved repository and configuration hash, or a local
  tarball's content hash and installed SDK version. It contains no auth tokens or
  absolute paths and may be committed. Older configuration without a repository
  record needs explicit `--reconnect` if `--repository` is supplied.
- Repeat `--sdk sdk.tgz` for local SDKs. Identical content and installation state skip
  reinstalling; changed tarball contents are applied even at the same version.
- Invalid managed configuration or integration stops setup without being executed
  or reset. Review package-manager lockfile changes whenever installation is needed.

CLI 0.3.3 and earlier repeated approval and installation on reruns; use 0.3.4 or later
for idempotent setup.

## Build admission check

Since 0.3.6, the CLI includes the following command.

`kue-qa check` reads the Expo app's managed `.kue/config.js` as data. `--app` selects
an app; `--config project.json` reads dashboard JSON instead. `--env` reads the
already-resolved `EXPO_PUBLIC_KUE_MODE`, `EXPO_PUBLIC_KUE_API_BASE_URL`,
`EXPO_PUBLIC_KUE_PROJECT_KEY` and optional `EXPO_PUBLIC_KUE_ENABLED`. These three
source options are mutually exclusive. Keys must never be command-line arguments.

Environment mode does not load dotenv: resolve Expo/EAS variables before invoking
it, using exactly the configuration embedded in the bundle. Explicit `local` mode
or `EXPO_PUBLIC_KUE_ENABLED=false` skips network access. Missing mode/configuration
is an error, not a successful skip.

The check sends only an authenticated GET to `/v1/project/check`. It checks the
current key, project admission, workspace quota/storage and delivery configuration.
Rejection, network/timeout failures, an unsupported server or an invalid response
exit nonzero. It never approves setup, modifies files, reserves quota or creates
reports/Issues. Unchanged `init` remains offline when recording is off; automatic
recording selection reads the current plan during setup.

## Manually mounted components

`init --skip-integration` manages connection files,
dependencies and recording selection without reading or editing JSX. Use it when
an existing custom wrapper already mounts KUE. It does not require an app root
and cannot be combined with `--root`. Once, wire `kueCloudConfig` from
`.kue/config.js` and `kueRecordingMode` from `.kue/recording.js` to that component.
The CLI cannot verify custom integration. Repeat this flag on subsequent runs;
add `--reconnect` only for explicit connection retrieval or replacement.

A newer matching CLI updates the SDK while preserving this manual placement.
Review the diff and use the existing application build/distribution workflow;
native inclusion changes require a new binary, including for TestFlight and
Google Play internal testing. The CLI does not build or distribute the app.

## Recording build selection

Production Cloud supports video admission. Use requires a recording-capable native build,
current Indie entitlement and Cloud with video admission enabled. Configuring
inclusion alone does not make recording available.

`kue.recording` in the selected app's `package.json` defaults to `auto`. The CLI
reads the connected workspace's `/v1/project/features` to configure native recorder
exclusion on Free or inclusion on Indie. `init --recording off` persists an opt-out;
`init --recording auto` restores automatic selection. Off skips the plan lookup.
Failures in auto mode stop before installation/local writes and preserve settings.

The SDK's recording-only native module is controlled by `expo.autolinking.exclude`
in package.json, including existing platform overrides. Screenshot peers remain
included. The generated `.kue/recording.js` + `.d.ts` bind the mode to the SDK, and
`.kue/setup.json` saves selection and a connection hash. Commit these alongside
the app root and manifest. Do not edit generated files. Identical setup preserves
bytes/mtime, although auto mode still performs the read-only plan request.

After a plan/setting change, rerun init, review the diff and rebuild with the app's
existing workflow. The CLI never starts a build or distribution. Native builds
use saved settings without querying Cloud. A managed `check` also verifies saved
selection against current entitlement, configuration and native exclusions, failing
on mismatch without modifying files. `--config`/`--env` check Cloud admission only.
Neither configuration nor a successful check grants runtime recording entitlement.

`--dry-run` performs no requests/writes and cannot verify the current plan.
`--skip-install` still resolves/saves recording selection. Runtime `recording="off"`
prevents recording but cannot remove code from an already-installed application.

Run this in a build hook and again before distributing. No readiness result is
cached. A pass does not test actual GitHub permissions, R2/queue connectivity,
image size, physical capture or later revocation/quota use; retain the end-to-end
test. The request timeout is 10 seconds. HTTPS origins only.

Production Cloud retains multiple connections on Free but allows submissions
from one selected repository. Its first accepted Free report starts a 24-hour
switching restriction. Connecting, checking and retrying do not switch it. A valid paused key
reports `project_plan_paused`, not `unauthorized`. Sign in to the dashboard for the
selected repository, switch date and billing status; do not rotate a key to select
another project. An invalid key cannot identify an account or expose its projects.
