# Changelog

## 0.3.1 — 2026-09-29

- Default `kue-qa init` to `https://kue.ischca.dev`, so production setup no longer
  requires `--server`. Explicit staging/local origins and `--config` still work.
- Document the default and retain origin validation, browser consent and offline
  dry-run behavior. SDK runtime behavior is unchanged; its version follows the CLI.

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
