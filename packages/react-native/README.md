# @kue-qa/react-native

Expo / React Native SDK for KUE. It captures the current iOS / Android screen, lets the developer crop the relevant area and add a memo, then sends a structured report to a callback or KUE Cloud. Without either, it logs only a setup reminder; memo, metadata, screenshot paths, and receipt tokens are omitted from built-in logs.

Supports Expo SDK 54–57, iOS and Android. MIT licensed. These instructions target
version `0.4.0`; confirm that version is available on npm before installation.
KUE Cloud availability is separate from the SDK release.
With Xcode 27 and Expo SDK 57, use `expo@57.0.23` or later, enable
`expo-build-properties` `ios.enableSceneSupport`, and regenerate the iOS project.

### Findings, groups and recording

Version 0.4.0 puts two actions on the finding screen. Create Issue sends the
current finding; with saved findings it adds the current one and opens a
confirmation whose title defaults to the first memo line. Add finding saves the
finding to the on-device draft without sending; it appears with `cloud`, or with
`onSubmitGroup` next to a custom `onSubmit`. A tap always captures. When the draft
holds 10 findings or its send result is unconfirmed, the new finding goes alone,
and Open saved findings shows the draft, then returns to the finding with its
crop and memo.

Groups (`onSubmitGroup`, `submitKueReportGroup`, `getKueProjectFeatures`) are
session-local, require explicit submission, contain up to 10 findings / 20 MiB,
and consume one capture of quota per finding. After the first attempt, retries keep
the exact payload and idempotency key. They do not use the existing offline outbox
or fall back to individual Issues. Custom `onSubmit` consumers must provide
`onSubmitGroup` separately.

Hold the floating button for 0.5 seconds to open a menu next to it. It lists only
what a tap cannot do: Create Issue (N) for saved findings, Screen recording, and
pending reports when the offline queue is enabled. Each item is named beside its
button; release over a button or its name to select it, or over the trigger or away
from the items to cancel. Early movement still drags the trigger. Rotation,
backgrounding and multitouch cancel selection. Screen readers and exceptionally
small host surfaces use an accessible list. Without menu items, a hold captures
like a tap.

Screen recording is offered with `cloud` (and `onSubmitGroup` next to a custom
`onSubmit`) unless `recording` is `off`; Free shows it with an Indie lock. The SDK includes
optional ReplayKit/MediaProjection recording, local playback/memo review, and
mixed image/video groups. Recordings are silent H.264 MP4, at most 60s / 20MiB;
the floating KUE button becomes a red square that stops recording when tapped,
retaining its position and disabling edge hiding and the long-press menu.
Cloud must enable video admission and verifies Indie again when saving. Nothing
uploads until explicit group confirmation. Recording requires a native app build;
Expo Go cannot load the recorder.
The matching CLI defaults `package.json` `kue.recording` to `auto`: configure
native recorder inclusion on Indie and exclusion on Free. `init --recording off`
persists an opt-out. CLI-generated `recording` props follow that mode; a manually
supplied `recording="off"` only disables runtime use, not native linking. Plan or
native inclusion changes require rerunning init and rebuilding; normal builds use
saved settings. Missing native support displays rebuild instructions without
repeating paid-plan status. Free locks and verification failures remain distinct.

Documentation: [English](https://kue.ischca.dev/en/docs) / [日本語](https://kue.ischca.dev/docs).

```bash
npx kue-qa@0.4.0 init
```

The CLI connects to `https://kue.ischca.dev` by default. Pass `--server URL` for
staging or a local server, or `--config project.json` for existing configuration.

The CLI can also run at a workspace root and detect its single Expo app. With
multiple apps, select one using `--app apps/mobile`.

Add `@kue-qa/react-native@0.4.0`, then its native peers:

```bash
npx expo install expo-application expo-constants expo-device expo-file-system expo-image-manipulator react-native-view-shot react-native-safe-area-context
```

```tsx
import { Kue } from "@kue-qa/react-native";

export default function App() {
  return (
    <>
      <YourApp />
      <Kue cloud={{
        apiBaseUrl: process.env.EXPO_PUBLIC_KUE_API_BASE_URL!,
        projectKey: process.env.EXPO_PUBLIC_KUE_PROJECT_KEY!,
      }} />
    </>
  );
}
```

`Kue` requires `cloud` or `onSubmit`; see [KUE Cloud](#kue-cloud) and the destination
rules at the end of this file.

Open the same reporter from another development trigger:

```ts
import { reportIssue } from "@kue-qa/react-native";

await reportIssue();
```

`enabled` defaults to `__DEV__`. Web capture is not supported.

Drag the floating KUE button anywhere within the safe area. Release against any edge
to tuck it away, leaving a small handle. Tap the handle to reveal the button, then
tap again to capture (or drag the handle back into the screen). Dragging never captures.
The position survives opening/closing the reporter during the current mount; it is
not persisted across app restarts. Rotation keeps the button reachable. Screen readers
also expose move/hide actions, and reduced-motion settings disable docking animations.

The default `buttonDesign="classic"` shows a viewfinder button. Select the character
with `<Kue cloud={cloud} buttonDesign="mascot" />`. Both use the same 54pt touch target, gestures
and accessibility actions. The static image is bundled for offline use; no extra
native module or asset-copy step is required.

## Metadata and optional triggers

OS version, device model, native app version/build and dimensions are automatic. Installed
Expo Updates metadata is included when available; no device/user identifier is collected.
`context` and per-call `reportIssue({ context })` take precedence. Pass anonymized route
templates through `context.route` (for Expo Router: `useSegments().join('/')`).

```tsx
import { shakeTrigger } from '@kue-qa/react-native/shake';
import { screenshotTrigger } from '@kue-qa/react-native/screenshot';
const triggers = [shakeTrigger, screenshotTrigger];
<Kue cloud={cloud} triggers={triggers} />
```

Install `expo-sensors` for shake and/or `expo-screen-capture` for screenshot via `expo install`,
and rebuild the development client. Both are optional peers and separate entry points.
Listeners run only while KUE is enabled, foregrounded and idle. The OS screenshot trigger
supports iOS/Android 14+, recaptures the app view into the editor, and never reads photos or
automatically sends. KUE does not request permissions or alter shared sensor intervals.
Block unused `ACTIVITY_RECOGNITION`, `READ_EXTERNAL_STORAGE`, and `READ_MEDIA_IMAGES` Android
permissions added by those Expo modules if the host does not otherwise use them.
`floatingButton={false}` hides the default button; `reportIssue()` remains available.

## Optional durable outbox

Set `<Kue cloud={cloud} offlineQueue />` to persist before upload and retry while the app is
foregrounded. No new native dependency, permission, host storage setup or background task
is needed. The private app directory is `Documents/kue-outbox-v1`: 10 reports / 50 MiB total,
10 MiB per image, 7-day retention (expired entries are removed on next outbox access).
Data is not separately encrypted and follows the host app's backup policy.

Retryable failures use backoff and Retry-After. Permanent failures are kept for manual action.
`onQueued({ clientReportId })` reports local persistence; `onReceipt` is reserved for Cloud
acceptance. Long-press/release the KUE button to view, resend or discard queued entries.
Destination/key changes never retarget an old report; the outbox can discard those entries.
Device-only custom saves are not imported. A custom `onSubmit` still takes precedence.

Programmatic alternatives: `pendingKueReports(cloud)`,
`retryPendingKueReports(cloud, { force: true })`, `discardPendingKueReport(cloud, id)`.
Disabling KUE stops future automatic retries but cannot recall an in-flight request.

The screenshot URI is temporary and remains valid until the `onSubmit` callback's returned
promise resolves. Copy or upload it inside `onSubmit` if it needs to be retained.

## KUE Cloud

Cloud projects belong to a workspace for one GitHub personal account or organization.
Connection requires that owner's GitHub permissions and repository administrator access;
install the KUE QA GitHub App on the destination repository. The first connecting user
becomes the KUE workspace owner. A submission key does not grant management or billing access.

Free includes one active project, 100 reports per UTC calendar month, 100 MB of image
storage, and 30-day image retention. Indie is US$12/month, tax included, per workspace:
unlimited projects, 5,000 reports per UTC calendar month, 10 GB, and 365-day image retention.
Limits are shared across the workspace, not charged per tester or device. New submissions
stop at the limits; there are no automatic overage charges. See the
[pricing page](https://kue.ischca.dev/en/pricing) for sales availability and terms.

Image retention starts when Cloud accepts a report. Upgrading does not extend existing
Free images. Indie images expire within 30 days after the subscription ends, without
extending their original deadline. Project/workspace deletion does not delete GitHub Issues.
Deleting a project or uninstalling the SDK does not cancel its workspace's subscription.
Use the [Documentation](https://kue.ischca.dev/en/docs#management) for billing, deletion,
and ownership-transfer procedures.

Read Expo public environment variables in application code and pass them to `Kue`. The package
does not read environment variables from `node_modules`.

```tsx
import { Kue, type KueCloudConfig } from "@kue-qa/react-native";

const cloud = {
  projectKey: process.env.EXPO_PUBLIC_KUE_PROJECT_KEY!,
  apiBaseUrl: process.env.EXPO_PUBLIC_KUE_API_BASE_URL!,
} satisfies KueCloudConfig;

export default function App() {
  return (
    <Kue
      cloud={cloud}
      onReceipt={(receipt) => console.info("KUE accepted", receipt.id, receipt.status)}
    />
  );
}
```

`apiBaseUrl` is an origin; the SDK appends `/v1/reports`. HTTPS is required outside development.
The public `pk_...` key is sent only as a create-report bearer token. A report closes after a valid
HTTP 202 receipt with status `received` or `queued`.

Accepted is not delivered. The dashboard shows the latest delivery status. To read one
report from the SDK, preserve its `receiptToken` privately and call:

```ts
import { getKueReportStatus } from "@kue-qa/react-native";
const status = await getKueReportStatus(receipt, { apiBaseUrl: cloud.apiBaseUrl });
// status.status === "completed" -> status.githubIssue?.url
```

No status polling runs automatically. The receipt grants read access to one report only;
do not log it. The image URL in the GitHub Issue is a bearer link, not a GitHub permission
check: anyone with the URL can view it. Crop out credentials and personal information.

The SDK keeps the prepared JPEG and `Idempotency-Key` stable for retries of an unchanged memo and
crop. Editing either creates a new logical report. Automatic upload retries are disabled unless
the optional durable outbox below is enabled.

`KueProps` requires `cloud` or `onSubmit`. With `onSubmit` or `onSubmitGroup`, `submitLabel`
names the action on the finding screen, the long-press menu and the confirmation; with
`cloud` only, the action reads Create Issue. When both are provided, `onSubmit` takes
priority over `cloud`. Untyped callers that pass neither only log a setup reminder and
do not save the report:

```text
onSubmit → cloud → console.info
```
