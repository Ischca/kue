# Changelog

## 0.5.0 — 2026-10-11

- Show the KUE screens in Japanese or English. Japanese is shown when it comes
  before English in the device's preferred languages, English otherwise.
- Add `locale` (`"ja"` or `"en"`) to fix the display language.
- Behavior change: devices that do not prefer Japanese over English now show
  English. Set `locale="ja"` to keep Japanese on every device.

## 0.4.0 — 2026-10-10

- Choose Add finding or Create Issue on the finding screen. Create Issue includes
  saved findings and confirms the title first. The long-press menu creates an
  Issue from saved findings without a new capture.
- Fix missing images in grouped findings and the offline outbox on Expo SDK 56
  and later.
- Fix Screen recording not starting when chosen from the long-press menu.
- Delete draft copies left behind when the app was terminated or reloaded.
- Breaking: `KueProps` requires `cloud` or `onSubmit`, and `submitLabel` with a
  custom `onSubmit` or `onSubmitGroup`. `KueProps` is now a type alias; use
  `KueDestination` to choose a destination at runtime.
- Show each long-press action's name beside its button, close to the trigger
  and in its style, without the separate preview box and gesture hints.
- The long-press menu no longer lists Screenshot, and hides Screen recording
  when `recording` is `off` or recordings cannot be sent (no `cloud`, or
  `onSubmit` without `onSubmitGroup`). A full or unconfirmed draft no longer blocks a
  capture: the new finding is sent on its own, and Open saved findings on the
  finding screen shows the draft without losing the new finding.

## 0.3.6 — 2026-10-09

- Add grouped screenshot findings and a long-press actions menu. Keep drafts
  local until explicit submission and send one Issue with up to 10 findings.
- Add optional silent screen recording with an in-place red-square stop button,
  local review and mixed image/video submission. Cloud admission requires an
  active Indie workspace and is already deployed. The native recorder passed
  start, stop, preview and interruption checks in a separate iPhone QA app;
  the full Indie submission flow still needs a registry-build device check.
- Add CLI build admission checks, recording build selection and
  `--skip-integration` for manually mounted components.
- Add an authenticated, read-only Cloud admission check without creating reports,
  Issues, media writes or quota use. Failed or unverified checks return nonzero.
- Update fixable development dependencies. Two unpatched Expo build-tool
  advisories remain under a path- and version-specific CI exception; any new
  advisory or changed dependency path fails the audit.

## Cloud Free destination selection — 2026-10-09

- Save repository connections without silently switching the active Free project.
  Require explicit confirmation before completing setup for an inactive project.
- Restrict Free repository switching for 24 hours from its first accepted report.
  Enforce the restriction atomically with report acceptance and selection, including
  concurrent uploads, key rotation, deletion/recreation and plan changes.
- Preserve keys, image retention and shared usage when switching after expiry.
  Checks, rejected uploads, retries and same-repository submissions do not extend
  the deadline. Indie can accept reports from multiple repositories.
- Show the authenticated repository, switch date and verified billing reason.
  Public submission errors do not reveal account or repository information.
- Retain deletion-prevention restriction metadata only until its existing deadline,
  then remove it during scheduled cleanup. Document this separately from monthly usage.

## Cloud connection completion — 2026-10-08

- Replace completed CLI approval URLs with the regular dashboard URL, removing
  the short-lived token and preventing approval replay on reload.
- Keep the dashboard accessible when an old approval link expires. Existing
  projects do not need to reconnect; retry only incomplete CLI setup.
- Preserve the 15-minute authorization expiry and single-use GitHub handoff.
- Update Japanese/English documentation. SDK and CLI remain at 0.3.4.

## 0.3.4 — 2026-10-03

- Make ordinary CLI `init` reuse managed configuration and skip authorization,
  dependency commands and file writes when setup already matches. Preserve mtimes.
- Install only a needed SDK update or missing native dependencies; refuse implicit
  downgrades and inconsistent installations. Preserve compatible native peers.
- Require explicit `--reconnect` for reauthorization or connection changes. Track
  local repository metadata and tarball hashes without credentials or absolute paths.
- Parse managed configuration as data, detect inconsistent integrations, and preserve
  edits made during authorization. Document behavior in Japanese and English.
- Keep the SDK API and runtime unchanged; release SDK 0.3.4 alongside the CLI's
  matching version pin.

## Cloud connection handoff — 2026-10-03

- Use one Connect action for the CLI's fixed repository, including GitHub authorization when needed.
- Return from GitHub in the same tab and complete the original connection after fresh permission checks.
- Resume safely via the browser's Back button when GitHub does not redirect back.
- Bind the handoff to the browser, account and destination, with expiring single-use consent.
- Keep canceled, unapproved and expired connections actionable; never substitute another repository.
- Update Japanese/English documentation. SDK and CLI remain at 0.3.3.

## Cloud first-connection UX — 2026-10-02

- Hide the workspace selector until a workspace exists; show repository setup first.
- Load repositories automatically and recheck access after returning from GitHub setup.
- Confirm the CLI's fixed destination without a redundant repository selector.
- Distinguish loading, access requirements, fetch failures and completed connections inline.
- Keep connection approval explicit and update Japanese/English documentation.
- SDK and CLI remain at 0.3.3; no npm package update is required.

## 0.3.3 — 2026-10-02

- Detect a single Expo app when `init` runs at a pnpm/npm/Yarn workspace root.
  List multiple candidates without changes and accept an explicit `--app` path.
- Keep dependency installation and generated configuration inside the selected
  app; preserve invocation-relative `--config` and `--sdk` paths.
- Publish the optional `buttonDesign="mascot"` character button. The default
  remains the classic KUE text button; gestures and accessibility are shared.
- Update Japanese/English documentation, package READMEs and website wording.

## Cloud paid launch — 2026-10-02

- Enable Indie purchasing through Stripe Managed Payments after sandbox
  purchase/cancellation verification and an unpaid production Checkout check.
- Update Japanese/English payment, currency, refund and privacy documentation.
- This Cloud launch did not publish a new SDK or CLI version.

## Cloud Documentation update — 2026-10-02 (deployed; paid sales disabled)

- Document workspace-based Cloud management and US$12/month, tax-included Indie
  subscriptions for one GitHub personal account or organization.
- Specify shared quotas, image storage and retention, cancellation, deletion, and
  eligible Free organization ownership transfers in Japanese and English.
- Keep SDK/CLI setup and API examples pinned to the published 0.3.2 release.
  No npm package release is required by this Cloud update.

The workspace Cloud update and Japanese/English Documentation are deployed. Paid
sales remain disabled, and Indie is not yet available for purchase. The published
SDK and CLI remain at 0.3.2; no npm package release accompanies this Cloud update.

## 0.3.2 — 2026-09-29

- Reject HTTP redirects and omit host-app cookies when submitting screenshots or
  reading report receipts. Built-in logs no longer include report payloads or
  callback exceptions that may contain private receipt tokens.
- Patch vulnerable development dependencies and audit them in verification CI.
  Pin third-party CI actions to verified commits.

## 0.3.1 — 2026-09-29

- Default `kue-qa init` to `https://kue.ischca.dev`, so production setup no longer
  requires `--server`. Explicit staging/local origins and `--config` still work.
- Document the default and retain origin validation, browser consent and offline
  dry-run behavior.

## 0.3.0 — 2026-09-29

- Publish SDK and CLI without a prerelease suffix, using the `latest`
  distribution tag. Installation no longer requires `@beta`.
- Resolve the CLI's exact SDK dependency from its own installed package version
  so setup cannot retain a stale beta version during subsequent releases.
- Existing `0.3.0-beta.4` artifacts remain unchanged. Production Cloud is deployed
  at `https://kue.ischca.dev`; general-user GitHub App installation is still being
  prepared. Paid subscriptions and production device verification remain separate.

## 0.3.0-beta.4 — 2026-09-28

The first public SDK/CLI beta includes the following local development
releases. These entries do not announce a production Cloud service.

- Capture, crop and annotate an app screenshot on iOS and Android.
- Drag the KUE button inside the safe area and dock it at any edge. Its position
  resets on app restart; screen rotation keeps it reachable.
- Automatically include OS, device model, app version/build and screen dimensions
  without collecting device or user identifiers.
- Open the reporter programmatically or with optional shake / OS screenshot
  triggers. Triggering never sends a report automatically.
- Opt into a bounded persistent offline queue with foreground retries and manual
  resend/discard controls. Existing `onSubmit` callbacks retain precedence.
- Submit reports to a configured KUE Cloud origin and query delivery using an
  individual receipt token. No automatic status polling is performed.
- Set up an existing Expo app with `kue-qa init`, including tarball installation,
  source backups and repeatable configuration. yalc is optional, not required.
- Validate the SDK/CLI on Expo SDK 54–57 with isolated consumer type checks and
  iOS/Android exports. These checks do not replace device testing of sensors.

Earlier 0.1.0, 0.2.0 and 0.3.0 beta candidates were local-development versions,
not npm releases. SDK and CLI code is MIT licensed; Cloud implementation is not
included in the public source.
