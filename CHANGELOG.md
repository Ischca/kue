# Changelog

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
