# Changelog

## Unreleased — Cloud connection completion

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
