# @kue-qa/react-native

Expo / React Native SDK for KUE. It captures the current iOS / Android screen, lets the developer crop the relevant area and add a memo, then sends a structured report to a callback, KUE Cloud, or `console.info`.

Supports Expo SDK 54–57, iOS and Android. MIT licensed. These instructions target
the `0.3.1` release. Registry commands require that version to be published; KUE
Cloud availability is separate from the SDK release.

```bash
npx kue-qa init
```

The CLI connects to `https://kue.ischca.dev` by default. Pass `--server URL` for
staging or a local server, or `--config project.json` for existing configuration.

For manual installation, add `@kue-qa/react-native@0.3.1`, then its native peers:

```bash
npx expo install expo-application expo-constants expo-device expo-file-system expo-image-manipulator react-native-view-shot react-native-safe-area-context
```

```tsx
import { Kue } from "@kue-qa/react-native";

export default function App() {
  return (
    <>
      <YourApp />
      <Kue />
    </>
  );
}
```

Open the same reporter from another development trigger:

```ts
import { reportIssue } from "@kue-qa/react-native";

await reportIssue();
```

`enabled` defaults to `__DEV__`. Web capture is not supported in Phase 1.

Drag the floating KUE button anywhere within the safe area. Release against any edge
to tuck it away, leaving a small handle. Tap the handle to reveal the button, then
tap again to capture (or drag the handle back into the screen). Dragging never captures.
The position survives opening/closing the reporter during the current mount; it is
not persisted across app restarts. Rotation keeps the button reachable. Screen readers
also expose move/hide actions, and reduced-motion settings disable docking animations.

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
is needed. The private app directory is `Documents/kue-outbox-v1`: 10 reports / 50MB total,
10MB per image, 7-day retention (expired entries are removed on next outbox access).
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

When both are provided, the Phase 1 `onSubmit` callback intentionally takes priority over `cloud`.
This makes upgrading additive for existing consumers:

```text
onSubmit → cloud → console.info
```
