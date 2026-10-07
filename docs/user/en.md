# KUE Documentation

KUE adds screen capture, cropping, and memo entry to Expo / React Native apps. Reports can be submitted to KUE Cloud for GitHub Issue creation or passed to an application-defined storage handler.

Version: SDK and CLI **0.3.4**. This documentation covers installation, public APIs, and Cloud usage limits.

## Requirements

| Component | Supported environment |
| --- | --- |
| Application | Expo SDK 54–57 / React Native |
| OS | iOS and Android. Web screen capture is not supported |
| CLI | Node.js 22.13 or later |
| License | SDK and CLI: MIT. Cloud: a separately provided hosted service |

Cloud integration requires a GitHub account and installation of the KUE QA GitHub App on the destination repository. The connecting user must own the personal repository or be an organization owner, and must also have administrator permission on the repository. Contact [support](mailto:kue@ischca.dev) if the App cannot be installed.

Custom storage through `onSubmit` does not require a Cloud account. Standard SDK installation and upgrades do not require yalc.

## CLI setup

### Procedure

Save application changes, then run the command from the Expo app package or the workspace root.

```sh
npx kue-qa init
```

If the current package declares an `expo` dependency, the CLI uses it directly. Otherwise, it detects Expo apps from `packages` in `pnpm-workspace.yaml` or `workspaces` in `package.json`. When both exist, the pnpm definition takes precedence. One candidate is selected automatically. Multiple candidates are listed and setup stops without changes. To select an app explicitly:

```sh
npx kue-qa init --app apps/mobile
```

Automatic discovery stays within the invocation directory. It skips hidden directories, symbolic links, `node_modules`, `vendor`, `build`, `dist`, `coverage`, `ios`, and `android`. If the search exceeds 2,000 directories or no workspace definition exists, use `--app` or run inside the app. `--app` must select a directory inside the invocation directory without symbolic links.

1. The CLI detects the root component and GitHub repository.
2. On first setup or explicit reconnection, sign in with GitHub in the browser, verify the destination, and press **Connect**. Authorize access to the target repository on GitHub only if required.
3. The CLI installs the SDK and dependencies, then adds KUE to the root component.
4. Review the diff and start Expo. Rebuild the development client if native dependencies were added.
5. Submit a report and verify its delivery status and Issue in the [dashboard](https://kue.ischca.dev/en/app).

Setup approval links expire after 15 minutes. Approve only setups initiated from your own terminal. Running `init` does not create an Issue.

After connection completes, the URL changes to the regular dashboard (`/en/app`). Opening an expired connection link also displays the dashboard after sign-in. Projects already set up do not need to reconnect. Run `init` again only if CLI setup is incomplete.

The destination repository's GitHub owner determines the workspace. The first connecting user becomes its KUE workspace owner. When a workspace already exists, another GitHub organization owner does not automatically receive KUE management access.

The connection page displays the CLI's fixed destination. Press **Connect** to connect immediately if access is already granted. Otherwise, the same tab opens GitHub. Choose the personal account or organization, then use **Only select repositories** to grant access only to the target repository. On return to KUE, access to the original destination is checked again and the connection completes. No second press of **Connect** is required.

After saving access on GitHub, use your browser's **Back** button to return to the original connection page if you are not redirected to KUE. The connection also resumes when you return this way.

The initial action is bound to the browser, signed-in account, and destination, and resumes once within its validity period. Canceling on GitHub, granting a different repository, or awaiting organization approval does not complete the connection. After approval, press **Reload**, then **Connect**. If an incomplete setup has expired, restart the CLI's `init` command. GitHub authorization cannot be skipped.

### Idempotent init

The following behavior applies to CLI 0.3.4 and later. Version 0.3.3 and earlier repeat connection approval, dependency installation, and configuration writes on subsequent runs.

Ordinary `init` exits without browser approval, network requests, package-manager execution, or file writes when the managed connection, integration, and installed dependencies are unchanged. File modification times and the lockfile are preserved. Existing 0.3.3 configuration files are supported. This is a local-state check, not a validation of Cloud connectivity or key validity.

| State or option | Behavior |
| --- | --- |
| SDK upgrade | Update to the CLI's SDK version. Preserve the connection and compatible existing native dependencies. An older CLI does not downgrade a newer SDK |
| Missing dependency | Add only undeclared SDK or required native dependencies. Native version ranges come from the installed Expo package |
| Inconsistent dependencies | Stop if a declared package is not installed or versions are inconsistent. Restore dependencies from the lockfile or review an explicit dependency update first |
| `--reconnect` | Explicitly request browser approval and retrieve configuration again. Combine with `--repository OWNER/REPO` to change destinations or `--server URL` to change servers |
| `--config project.json` | Apply the explicitly supplied configuration without rewriting identical values. Cannot be combined with `--reconnect`, `--repository`, or `--server` |
| `--skip-install` | Skip dependency checks and additions. This does not indicate that dependencies are correctly installed |
| `--sdk sdk.tgz` | Compare the local tarball's content hash and installation state. Identical inputs do not reinstall it. Continue supplying this option when using the local tarball |
| Inconsistent managed files | Never execute JavaScript configuration or silently reset invalid configuration, integration, or customized type declarations; stop instead |

After browser approval, `.kue/setup.json` stores the destination and configuration hash. For a local tarball it stores the content hash and SDK version. It contains no authentication tokens or absolute paths and may be committed. If the destination is not recorded, as with older configurations, supplying `--repository` requires explicit `--reconnect`. Ordinary reruns never change the destination based on changes to the Git remote.

When an installation is necessary, the package manager may update related lockfile entries. Review the diff. Explicit `--reconnect` requests approval on every run.

### Options

| Option | Behavior |
| --- | --- |
| `--dry-run` | Display detection results without network requests or file changes |
| `--app apps/mobile` | Select the Expo package. Relative paths use the command's invocation directory |
| `--repository OWNER/REPO` | Specify the destination GitHub repository |
| `--reconnect` | Explicitly retrieve connection configuration again; also required to change an existing destination or server |
| `--root app/_layout.tsx` | Specify the root file to modify |
| `--no-open` | Print the approval link without opening a browser |
| `--config project.json` | Use public configuration JSON from the dashboard instead of browser approval |
| `--skip-install` | Skip dependency installation; install required packages separately |
| `--server https://YOUR-KUE-HOST` | Override the Cloud server. Default: `https://kue.ischca.dev` |
| `--sdk /path/to/sdk.tgz` | Use a local SDK tarball for testing |

Relative `--root` paths use the selected app directory. Relative `--config` and `--sdk` paths use the command's invocation directory. Dependencies and `.kue` are added inside the selected app. Package-manager detection checks `packageManager` and lockfiles from the app up through its parent directories.

With `--config`, the server URL comes from the JSON file. If the root component structure is unsupported by the CLI, integrate the SDK manually.

### Generated files

| File | Contents and handling |
| --- | --- |
| `.kue/config.js` / `.kue/config.d.ts` | Connection configuration and types, including a public create-only key. May be committed |
| `.kue/backup-*.txt` | Original application source. Keep local and exclude from commits |

The CLI does not store GitHub user tokens or billing credentials in the application.

## Manual SDK installation

### Dependencies

The example uses npm. Use the application's existing package manager and maintain one lockfile format.

```sh
npm install @kue-qa/react-native@0.3.4
npx expo install expo-application expo-constants expo-device expo-file-system expo-image-manipulator react-native-view-shot react-native-safe-area-context
```

### Cloud connection and mounting

Add the public configuration obtained from the dashboard to `.env.local`. Replace the example key with the project's create-only key. Do not use GitHub tokens or private keys.

```dotenv
EXPO_PUBLIC_KUE_API_BASE_URL=https://kue.ischca.dev
EXPO_PUBLIC_KUE_PROJECT_KEY=pk_REPLACE_WITH_PROJECT_KEY
```

Mount one `Kue` component at the application root. The following example uses Expo Router's `app/_layout.tsx`.

```tsx
import { Stack } from 'expo-router';
import { Kue } from '@kue-qa/react-native';

export default function RootLayout() {
  return (
    <>
      <Stack />
      <Kue cloud={{
        apiBaseUrl: process.env.EXPO_PUBLIC_KUE_API_BASE_URL!,
        projectKey: process.env.EXPO_PUBLIC_KUE_PROJECT_KEY!,
      }} />
    </>
  );
}
```

Replace `Stack` with `Slot` when required by the router configuration. Without Expo Router, mount KUE in the application's root component. Environment variables are read by application code; the SDK does not read them automatically.

### Custom storage

`onSubmit` receives a `KueLocalReport` and returns `void` or `Promise<void>`. In the example, `saveReportAndCopyImage` is a storage function implemented by the application.

```tsx
<Kue onSubmit={async (report) => {
  await saveReportAndCopyImage(report);
}} />
```

When both `onSubmit` and `cloud` are configured, `onSubmit` takes precedence. Cloud submission and the offline queue are bypassed. With neither configured, reports are not saved automatically.

The image URI references a temporary file. Copy or upload the image before the callback's Promise resolves if it must remain available afterward.

| `KueLocalReport` field | Contents |
| --- | --- |
| `clientReportId` | Identifier retained when retrying the same prepared payload |
| `memo` | Entered memo |
| `crop` | Normalized crop coordinates: `x`, `y`, `width`, and `height` |
| `screenshot` | Cropped image URI, width, height, and MIME type |
| `sourceSize` | Original image width and height |
| `context` | Device and application metadata |
| `capturedAt` | Capture timestamp |

## Capture and Issue creation

### Procedure

1. Tap the KUE button to start a capture.
2. Select the relevant area and enter a memo.
3. Check that the report contains no secrets or personal information, then select Send.
4. For Cloud submissions, check delivery status and the created Issue in the dashboard.

### Floating button

The default is the KUE text button. Set `buttonDesign="mascot"` to display the character. Both designs share the same gestures and touch target. The image is bundled with the SDK; no additional download or native dependency is required.

```tsx
<Kue cloud={cloud} buttonDesign="mascot" />
```

| Action | Result |
| --- | --- |
| Tap | Start a capture |
| Drag | Move the button without capturing |
| Release at a screen edge | Dock the button as a small handle |
| Tap the handle | Restore the button |
| Long-press and release | Open pending reports when the offline queue is enabled |

Position is not retained across application restarts.

### Issue contents

Issues contain the cropped image, memo, and device/application metadata. The default label is `kue`. KUE creates the label when missing and leaves existing label settings unchanged. Custom label names are not supported.

## SDK configuration reference

### KueProps

All props are optional. Submission or storage requires either `cloud` or `onSubmit`.

| Prop | Default | Behavior |
| --- | --- | --- |
| `enabled` | `__DEV__` | Enable or disable the SDK. Disabled by default in release builds |
| `cloud` | Not set | Configure Cloud submission with `KueCloudConfig` |
| `onSubmit` | Not set | Custom storage callback. Takes precedence over `cloud` |
| `context` | `{}` | Add to or override automatically collected metadata |
| `floatingButton` | `true` | Show the button. Other triggers remain available when `false` |
| `buttonDesign` | `"classic"` | `"classic"` uses the text button; `"mascot"` uses the character |
| `triggers` | Not set | Array of additional trigger sources |
| `offlineQueue` | `false` | Persist pending Cloud submissions on the device |
| `onQueued` | Not set | Notify with `clientReportId` after local persistence when Cloud has not accepted the report |
| `onReceipt` | Not set | Notify with `KueReceipt` after Cloud acceptance |
| `onError` | Not set | Handle capture and submission errors. An alert is shown when omitted |
| `capture` | Built-in capture | Replace capture with a `KueCaptureAdapter` for tests or custom implementations |

For internal QA release builds, set `enabled` using an explicit application-owned condition. Avoid enabling it unconditionally in builds distributed to all end users.

### KueCloudConfig

| Property | Required / default | Description |
| --- | --- | --- |
| `apiBaseUrl` | Required | Cloud base URL, without `/v1/reports` |
| `projectKey` | Required | Public create-only key in `pk_...` format |
| `timeoutMs` | Default `15000` | HTTP request timeout in milliseconds |

### Metadata

KUE collects the OS, device model, application version/build number, and screen dimensions. Expo Updates information is included when available. Device identifiers, personal device names, and screen routes are not collected automatically.

Set application-specific metadata through `context`. This example supplies a route template from Expo Router.

```tsx
import { useSegments } from 'expo-router';
import { Kue, type KueCloudConfig } from '@kue-qa/react-native';

export function QaReporter({ cloud }: { cloud: KueCloudConfig }) {
  const segments = useSegments();
  return <Kue cloud={cloud} context={{ route: `/${segments.join('/')}` }} />;
}
```

Do not mount a second `Kue` when using this component. Metadata precedence is automatic values, then `context`, then `reportIssue({ context })`. Use anonymized route templates rather than URL query strings or user IDs.

## Trigger API and sources

### reportIssue

`reportIssue(options?): Promise<void>` opens a mounted, enabled KUE reporter. `options.memo` sets the initial memo; `options.context` supplies metadata for that report.

```ts
import { reportIssue } from '@kue-qa/react-native';
await reportIssue({ memo: 'Describe the issue' });
```

The call rejects with `KueUnavailableError` when no enabled KUE instance is mounted. This API does not submit a report or return a receipt.

### Shake and screenshot

Additional triggers are optional. Install the modules used by the application and rebuild the development client.

```sh
npx expo install expo-sensors expo-screen-capture
```

```tsx
import { shakeTrigger } from '@kue-qa/react-native/shake';
import { screenshotTrigger } from '@kue-qa/react-native/screenshot';

const triggers = [shakeTrigger, screenshotTrigger];
<Kue cloud={cloud} triggers={triggers} />
```

`cloud` is an existing `KueCloudConfig`. Keep the array reference stable, for example by defining it outside the component. Set `floatingButton={false}` to hide only the button.

| Trigger | Dependency | Support and behavior |
| --- | --- | --- |
| `shakeTrigger` | `expo-sensors` | Open the reporter when a shake is detected |
| `screenshotTrigger` | `expo-screen-capture` | iOS and Android 14+. Detect an OS screenshot and recapture the current application view |

Sources are subscribed while KUE is enabled, foregrounded, and idle. They do not read the photo library or submit automatically.

### Android permissions

KUE does not request additional permissions or modify shared sensor sampling intervals. Optional Expo modules may add `ACTIVITY_RECOGNITION`, `READ_EXTERNAL_STORAGE`, or `READ_MEDIA_IMAGES`. Exclude them with `android.blockedPermissions` only when no other application feature needs them. Keep `DETECT_SCREEN_CAPTURE` for screenshot detection on Android 14+.

## Offline queue

### Configuration

`offlineQueue` is a persistent queue for Cloud submissions. It is disabled by default and does not apply to custom storage through `onSubmit`.

```tsx
<Kue cloud={cloud} offlineQueue />
```

Reports are written to the application's `Documents/kue-outbox-v1` before uploading. No additional native dependency, permission, or application-owned database setup is required.

### Limits and retries

| Item | Value or behavior |
| --- | --- |
| Report count | 10 across all destinations |
| Total storage | 50 MiB |
| Individual image | Up to 10 MiB |
| Retention | 7 days. Expired entries are removed on the next queue access |
| Automatic retries | Run while foregrounded. Execution while closed or backgrounded is not guaranteed |
| Network failure | Retry after a delay |
| Invalid key or quota limit | Stop automatic retries and wait for manual action |

Changing the destination or key does not redirect existing entries to the new destination. `onQueued` is called for locally persisted reports not yet accepted by Cloud; `onReceipt` is called after Cloud acceptance.

### Management API

Import the following functions from `@kue-qa/react-native`. `cloud` is the destination configuration; `id` is the entry's `clientReportId`.

| API | Result |
| --- | --- |
| `pendingKueReports(cloud)` | Read pending report identifiers, save times, and states |
| `retryPendingKueReports(cloud, { force: true })` | Retry manually. Returns `Promise<void>` |
| `discardPendingKueReport(cloud, id)` | Discard the specified local entry |

There is no SDK-specific encryption. Backups follow the host application's policy. Discarding local data does not recall reports already accepted by Cloud.

## Workspace management and delivery status

### Workspaces and permissions

A workspace corresponds to one GitHub personal account or organization and owns its subscription, projects, and usage. Repositories belonging to a different GitHub owner require a separate workspace. Renaming a repository does not change its workspace. Transferring it to a different GitHub owner does not automatically change its KUE workspace.

Management requires signing in with your own GitHub account, KUE workspace membership, and current GitHub owner permissions. A create-only key does not grant management access. There are no per-tester or per-device charges, but one subscription cannot cover separate owners or separate clients' work. Member invitations are not supported.

### Dashboard

On first use, the [dashboard](https://kue.ischca.dev/en/app) shows repository setup without an empty workspace selector. The repository list loads automatically. If none are available, press **Connect** to authorize access on GitHub. When opening the dashboard without the CLI, no destination is specified: select a repository after returning, then press **Connect**. Use **Configure GitHub access** to add a repository that is not listed. A workspace is created automatically when you connect.

After connection, select a workspace to inspect its connection settings, plan, monthly submissions, image storage, and 20 most recent reports. Only the KUE workspace owner can manage billing, delete the workspace, or transfer ownership.

| Operation | Effect |
| --- | --- |
| Retrieve public configuration | Display SDK configuration for a connected project |
| Rotate a project key | Revoke the old key. Update all consuming apps. Existing Issues remain |
| Retry delivery | Reprocess a failed report. Check for an existing Issue when creation is uncertain |
| Select the active Free project | Choose the one project allowed to submit. Pausing is distinct from deletion |
| Delete a project | Stop submissions and schedule images and reports for deletion. GitHub Issues are not deleted |

### Purchase and cancellation

1. Confirm the target workspace in the dashboard. Review the limits, retention, cancellation, and refund conditions on the [pricing page](https://kue.ischca.dev/en/pricing) and in the [Terms of Service](https://kue.ischca.dev/en/terms). Use the Indie purchase action to open Stripe Checkout. Check the final amount, payment currency, and automatic monthly renewal, then agree to the terms before purchasing.
2. Verify the Indie plan and subscription expiry in the dashboard. Refresh billing status if the update is delayed. Returning from Checkout does not itself confirm that the plan has been applied.
3. Use billing management to open the Stripe Customer Portal for payment methods, invoices, and cancellation. Cancel before the next renewal to return to Free at the end of the paid period.

Subscriptions renew monthly. The billing cycle and monthly submission quota reset are separate. Free limits apply if payment fails and an active subscription cannot be confirmed. After correcting the payment method, refresh billing status. Deleting a project or uninstalling the SDK does not cancel a subscription.

Payments use Stripe Managed Payments. Checkout may display and charge a local currency, and Link sends receipts and invoices. In addition to KUE billing management, Link provides order, subscription, and payment-method management. Link's refund terms presented at purchase may take precedence; rights under applicable law are not limited. A data-deletion request to Link may end the subscription. Request deletion of KUE images and reports separately in KUE.

### Ownership transfer

Self-service transfer is limited to Free organization workspaces for which no Stripe billing account has been created. Personal workspaces and workspaces with a billing account created by starting Checkout are ineligible. Contact support for other ownership changes.

1. The recipient signs in to KUE with their own GitHub account. They must have GitHub organization owner permissions when accepting.
2. The current KUE owner enters the recipient's GitHub username and the organization name in the dashboard to request a transfer.
3. The recipient verifies the organization name in their dashboard and accepts within 24 hours. The sender can cancel; the recipient can decline.

Purchases are unavailable while a transfer is pending. Completion removes the previous owner's KUE management access but preserves projects, submission keys, and usage. The new owner should rotate submission keys if necessary. This operation does not change GitHub organization ownership itself.

### Workspace deletion and account removal

1. If a subscription exists, cancel it first and wait for it to end. Deletion is unavailable while Checkout or billing reconciliation is pending.
2. Delete the selected workspace by confirming its GitHub owner name. Submissions and KUE image access stop for all its projects.
3. After all owned workspaces have been fully deleted or transferred, expand **Delete account** and confirm your GitHub username to delete your account.

Images, reports, and workspace information are removed progressively after a 15-minute grace period for in-flight uploads. Completion takes at least 15 minutes and may take longer depending on processing and external services. Account removal also revokes sessions and memberships in other workspaces; it does not delete projects belonging to other owners.

GitHub Issues and Stripe invoices are not deleted. KUE cannot open the workspace's billing portal after the workspace is deleted, so retrieve any required invoices first. See data retention below for image-cache and current-month usage records.

### Delivery status

`getKueReportStatus(receipt, { apiBaseUrl }): Promise<KueReportStatus>` retrieves the report's state. `receipt` requires the `id` and `receiptToken` returned at acceptance. The SDK does not poll automatically.

| `status` | Meaning |
| --- | --- |
| `received` | Accepted |
| `queued` | Waiting in the delivery queue |
| `creating_issue` | Issue creation in progress |
| `completed` | Issue created. `githubIssue` contains its number and URL |
| `failed` | Delivery failed. Inspect `error.code` |

`receiptToken` is a secret capability for reading the report. Do not include it in source code, public Issues, or logs.

## Usage limits and data retention

### Plans and limits

| Item | Free | Indie |
| --- | --- | --- |
| Monthly price per workspace | US$0 | US$12, tax included |
| Active submission projects | 1 | Unlimited |
| Monthly submissions | 100 | 5,000 |
| Image storage | 100 MB | 10 GB |
| Image retention | 30 days after acceptance | 365 days after acceptance |

Submission counts and storage are shared across the workspace. One MB is 1,000,000 bytes; one GB is 1,000,000,000 bytes. Monthly quota resets at 00:00 UTC on the first day of each month. Base prices are in US dollars. Check the final amount and payment currency at Checkout. Currency conversion may include a fee, and your card provider or other payment provider may charge separate fees.

New submissions are rejected when monthly quota or storage capacity is reached. There are no automatic overage charges. Accepted reports count toward the monthly quota even if delivery fails; retrying or deleting a report does not restore quota.

Free permits one connected project. If multiple projects remain after returning from Indie to Free, only the selected project can submit; the others are paused. If storage exceeds the Free limit, even the active project cannot submit new reports. Sales availability and conditions are listed on the [pricing page](https://kue.ischca.dev/en/pricing).

### Expiry and deletion

Image retention is determined by the plan at acceptance. Upgrading does not extend images previously accepted under Free. After an Indie subscription ends, Indie images expire within 30 days of the subscription end, without extending the original 365-day deadline. Each report's expiry is displayed in the dashboard.

After expiry, original images are deleted progressively and their links are replaced with an expiry notice. A delivery-disabled placeholder containing no original image may remain to prevent republication. GitHub Issue text and memos remain. Image expiry alone does not delete KUE report information; that information is removed through project or workspace deletion.

CDN, browser, and GitHub caches may delay the visible change. Immediate revocation of viewing access and deletion of copies saved by third parties are not guaranteed. Expired images cannot be restored.

Deleting and recreating a workspace does not reset the current month's quota. To prevent repeated quota resets, KUE retains the current month's usage count and pseudonymized information for matching the same GitHub owner. Expired records are removed by scheduled cleanup from the following month onward. This is not a guarantee of anonymization.

### Access and sensitive data

- Anyone with an image URL can view the image. Access is not tied to GitHub repository permissions, including for private repositories.
- The create-only key is public configuration suitable for embedding in the application. A third party who obtains it can also submit reports. Rotate the key if abused.
- Do not log images, memos, or receipt tokens. Remove secrets and personal information before submission.

Related documents: [Terms of Service](https://kue.ischca.dev/en/terms) / [Privacy Policy](https://kue.ischca.dev/en/privacy).

## Upgrades and removal

### SDK upgrades

Install the current stable version explicitly. For another release, verify the published version and release notes before replacing the version number.

```sh
npm install @kue-qa/react-native@0.3.4
```

To upgrade the SDK with the CLI, specify the target version. Existing connection configuration is reused. Add `--reconnect` only when retrieving configuration again.

```sh
npx kue-qa@0.3.4 init
```

The CLI uses the SDK at its own version. CLI 0.3.4 and later refuse implicit downgrades of a newer SDK. When nothing has changed, `init` does not write any files. Review the diff when upgrading. No SDK updates occur without running an update command.

Rebuild the development client after changing native dependencies and verify capture and submission on a physical device. Manage dependency versions through the application's lockfile.

### Removal

1. Submit or discard locally queued reports.
2. Remove `Kue`, application-defined triggers, and connection configuration.
3. Uninstall the SDK. Remove shared Expo dependencies only after checking whether other features use them.

Uninstalling the SDK does not delete Cloud projects or GitHub Issues.

## Troubleshooting

### Symptoms and checks

| Symptom | Checks and resolution |
| --- | --- |
| Button not visible | Check `enabled`, `floatingButton`, root mounting, and the docked handle. Release builds disable KUE by default |
| No Issue after local persistence | Check `onSubmit` precedence, `cloud` configuration, the queue, and delivery status |
| Repository not listed | Check personal or organization owner permissions, repository administrator permissions, App repository access, and Issues availability, then refresh the list |
| Workspace unavailable | Check the selected workspace, KUE membership, and current GitHub owner permissions. Other organization owners do not automatically receive access |
| Still Free after purchase | Verify the selected workspace and refresh billing status. Do not purchase again; contact support if unresolved |
| Workspace deletion unavailable | Confirm the subscription has ended, open Checkout sessions have expired, and billing reconciliation has completed. Scheduling cancellation is not sufficient |
| Account removal unavailable | Verify that every owned workspace has been transferred or physically deleted |
| CLI cannot detect a root | Run `--dry-run` in the application package and specify `--root`. Use manual integration for unsupported structures |
| Setup approval link expired | Run `init` again from your own terminal. Do not share approval links |
| 401 or invalid project key | Use current dashboard configuration. Entries using an old key are not automatically migrated |
| Submission blocked with 403, 409, or 429 | Check workspace quota, storage, and the active project. Wait before retrying a short-term rate limit |
| Image unavailable | Check retention and deletion status. Wait after a viewing rate limit. Expired images cannot be restored |
| Capture or additional trigger unavailable | Check OS support, dependencies, and the development client rebuild. Test with the button when using a simulator |

### SDK errors

Cloud communication errors are classified by `KueCloudError.code`. `status` is available when an HTTP response was received; `serverCode` is available when the server supplied an error code.

| `code` | Category |
| --- | --- |
| `invalid_config` | Invalid connection configuration |
| `invalid_report` | Invalid report payload |
| `network_error` | Network failure |
| `request_timeout` | Request timeout |
| `unexpected_response` | Unexpected response format |
| `upload_rejected` | Request rejected by the server |

### Support

When contacting [support](mailto:kue@ischca.dev), include SDK, CLI, Expo, and OS versions; the timestamp; reproduction steps; the error code; and a requestId if available. Do not attach private keys, GitHub tokens, `receiptToken` values, image URLs, or screenshots containing personal information.
