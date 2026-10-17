# KUE Documentation

KUE adds screen capture, cropping, and memo entry to Expo, native iOS/Android, Flutter, and React Native apps without Expo. Reports can be submitted to KUE Cloud for GitHub Issue creation or passed to an application-defined storage handler.

Target version: SDK and CLI **0.6.0**. Expo and Expo-free React Native packages and the CLI are distributed on npm; Flutter core and recorder are distributed on pub.dev. Native iOS uses Swift Package Manager with the matching `v0.6.0` tag, or a GitHub Release ZIP. Native Android is distributed on Maven Central; the existing Android Maven ZIP and its coordinates remain available. Cloud limits describe the current production service. Recording also requires a native build that includes the recorder and an active entitlement.

## Requirements

| Component | Supported environment |
| --- | --- |
| Expo SDK | Expo SDK 54–57 / iOS and Android. `@kue-qa/react-native` |
| Native iOS | UIKit/SwiftUI, iOS 15+, Swift 5.9+ |
| Native Android | Views/Compose, Android 8/API 26+, Kotlin/JVM 17 |
| Flutter | Flutter 3.32+ / Dart 3.8+, iOS 15+ / Android API 26+ |
| React Native without Expo | RN 0.86.2, React 19.2.3, New Architecture, iOS 15.1+ / Android API 26+ |
| OS | iOS and Android. Web screen capture is not supported |
| CLI | Node.js 22.13 or later. Automatic setup is for Expo apps only |
| License | SDK and CLI: MIT. Cloud: a separately provided hosted service |

When building an Expo SDK 57 app with Xcode 27 (the iOS 27 SDK), use `expo@57.0.23` or later, set `ios.enableSceneSupport` to `true` in `expo-build-properties`, and regenerate the iOS project. An app built with the iOS 27 SDK without scene support cannot launch on iOS 27.

Cloud integration requires a GitHub account and installation of the KUE QA GitHub App on the destination repository. The connecting user must own the personal repository or be an organization owner, and must also have administrator permission on the repository. Contact [support](mailto:kue@ischca.dev) if the App cannot be installed.

Custom storage through `onSubmit` does not require a Cloud account.

## Workspace management and delivery status

### Workspaces and permissions

A workspace corresponds to one GitHub personal account or organization and owns its subscription, projects, and usage. Repositories belonging to a different GitHub owner require a separate workspace. Renaming a repository does not change its workspace. Transferring it to a different GitHub owner does not automatically change its KUE workspace.

Management requires signing in with your own GitHub account, KUE workspace membership, and current GitHub owner permissions. A project key does not grant management access. There are no per-tester or per-device charges, but one subscription cannot cover separate owners or separate clients' work. Member invitations are not supported.

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

Purchases are unavailable while a transfer is pending. Completion removes the previous owner's KUE management access but preserves projects, project keys, and usage. The new owner should rotate project keys if necessary. This operation does not change GitHub organization ownership itself.

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

Free allows multiple saved connections, but only the selected project can submit; the others are paused. The same restriction applies after returning from Indie to Free. If storage exceeds the Free limit, even the active project cannot submit new reports. Sales availability and conditions are listed on the [pricing page](https://kue.ischca.dev/en/pricing).

### Free destination switching

Multiple connections can be saved, but only the selected repository can accept new Free submissions. The first connection is the initial selection. Connecting another repository asks for confirmation showing the current and proposed destinations. Canceling preserves the connection without changing the destination or completing CLI setup. Switching existing destinations does not require key rotation or manual environment-variable updates.

The first accepted Free report for a new destination restricts switching to another repository for 24 hours, measured from server acceptance rather than the device capture time. Connecting, pre-build checks and failed uploads do not start this restriction. An accepted report still counts and retains the restriction if Issue creation later fails. The dashboard shows the deadline.

Expiry does not switch the destination automatically. Use **Use this project on Free** in the dashboard, or confirm the switch when connecting another app. New submissions from the previous project are immediately rejected. The first Free report accepted for the new repository starts another 24-hour period. Continued use of the same repository, retries of existing reports and key rotation do not extend the deadline. Reports accepted before switching can still be delivered.

The switching restriction follows the immutable GitHub repository ID. Renaming, project or workspace deletion/recreation, and switching between Free and Indie do not remove it. Active Indie subscriptions allow multiple projects to submit. Returning to Free restores the saved selection and any unexpired switching restriction; a deleted selection is not automatically replaced with another project. The 100 monthly reports and storage capacity are shared across projects and do not reset on switching. This restriction applies to repositories within a GitHub owner's workspace, not to the number of apps or devices using the same repository and key.

A valid key for an inactive project returns `project_plan_paused`; a switch during the restriction returns `free_project_locked`. These differ from an invalid or revoked key. Repository and billing details are shown only after GitHub sign-in, never disclosed through an invalid project key. The dashboard distinguishes payment issues confirmed by Stripe synchronization, an ended subscription and an unconfirmed paid period. Returning to Free does not itself cancel a subscription; payment retries may continue.

To prevent deletion/recreation from bypassing the switching restriction, KUE separately retains a secret-keyed hash of the GitHub owner's ID and type, the selected GitHub repository ID and the existing deadline after workspace deletion. This record contains no personal or repository names, project keys, submitted content or Stripe IDs. It is pseudonymized, not guaranteed anonymous. It is no longer used after expiry and is removed by scheduled cleanup. Deletion never extends the 24-hour deadline.

### Expiry and deletion

Image retention is determined by the plan at acceptance. Upgrading does not extend images previously accepted under Free. After an Indie subscription ends, Indie images expire within 30 days of the subscription end, without extending the original 365-day deadline. Each report's expiry is displayed in the dashboard.

After expiry, original images are deleted progressively and their links are replaced with an expiry notice. A delivery-disabled placeholder containing no original image may remain to prevent republication. GitHub Issue text and memos remain. Image expiry alone does not delete KUE report information; that information is removed through project or workspace deletion.

CDN, browser, and GitHub caches may delay the visible change. Immediate revocation of viewing access and deletion of copies saved by third parties are not guaranteed. Expired images cannot be restored.

Deleting and recreating a workspace does not reset the current month's quota. To prevent repeated quota resets, KUE retains the current month's usage count and pseudonymized information for matching the same GitHub owner. Expired records are removed by scheduled cleanup from the following month onward. This is not a guarantee of anonymization.

### Access and sensitive data

- Use HTTPS for Cloud communication. HTTP requests to APIs, authentication endpoints, and images are rejected with 403. Only GET/HEAD requests to standard pages without a query string, Authorization, or Cookie receive a 308 redirect to HTTPS. Redirecting or rejecting a request cannot protect data already sent over HTTP.
- Anyone with an image URL can view the image. Access is not tied to GitHub repository permissions, including for private repositories.
- The project key is public configuration suitable for embedding in the application. A third party who obtains it can also submit reports. Rotate the key if abused.
- After rotation, the old key cannot submit new reports. Rotation does not cancel delivery of previously accepted reports or revoke their image URLs.
- Do not log images, memos, or receipt tokens. Remove secrets and personal information before submission.

Related documents: [Terms of Service](https://kue.ischca.dev/en/terms) / [Privacy Policy](https://kue.ischca.dev/en/privacy).

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
| Setup approval link expired | Use the dashboard if setup is complete. Run `init` again from your own terminal only if setup is incomplete. Do not share approval links |
| 401 or invalid project key | Use current dashboard configuration. Entries using an old key are not automatically migrated |
| Submission blocked with 403, 409, or 429 | Check workspace quota, storage, and the active project. Wait before retrying a short-term rate limit |
| Image unavailable | Check retention and deletion status. Wait after a viewing rate limit. Expired images cannot be restored |
| Capture or additional trigger unavailable | Check OS support, dependencies, and the development client rebuild. Test with the button when using a simulator |

### Support

When contacting [support](mailto:kue@ischca.dev), include SDK, CLI, framework, and OS versions; the timestamp; reproduction steps; the error code; and a requestId if available. Do not attach private keys, GitHub tokens, `receiptToken` values, image URLs, or screenshots containing personal information.
