# KUE

Capture a visual issue without leaving your Expo / React Native app: take a
screenshot, crop it, add a memo, and submit it through your own callback or KUE Cloud.

This repository contains the MIT-licensed SDK and setup CLI only. KUE Cloud is a
separately operated service; its server code, configuration and credentials are
not part of this repository.

## Packages

- [`@kue-qa/react-native`](packages/react-native/README.md): iOS / Android capture,
  crop and memo editor, movable edge-docking button, automatic app/device metadata,
  optional shake/screenshot triggers and durable offline queue.
- [`kue-qa`](packages/cli/README.md): Expo setup CLI with browser-approved Cloud
  configuration, repeatable source integration and local tarball support.

Supports Expo SDK 54–57. The CLI requires Node.js 22.13 or newer. KUE is enabled
only in development by default. Web capture is not supported.

## Try it

The initial beta and hosted service are being prepared. Registry commands below
apply only after the npm release is announced; they do not imply hosted availability.

```sh
# From the Expo app directory, using the Cloud origin provided to you:
npx kue-qa@beta init --server https://YOUR-KUE-HOST
```

No Cloud account is needed to use the SDK with your own `onSubmit` callback.
See the [SDK installation and API guide](packages/react-native/README.md) for
manual integration and the [CLI guide](packages/cli/README.md) for tarball setup.
Upgrades use normal package versions and your app's lockfile; yalc is not required.

## Data handling

Review screenshots before sending and crop out personal information or secrets.
The optional offline queue stores reports inside the host app's private documents
directory and follows its backup policy; it is not separately encrypted.
Cloud image links grant access to anyone who has the link. See the SDK guide for
receipt tokens, retry behavior and optional trigger limitations.

## Development

Use Node.js 24 and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
```

CI runs type checks, SDK/CLI tests, builds and package-content previews. It has no
publication or deployment step. See [CHANGELOG.md](CHANGELOG.md) for the candidate
release and [LICENSE](LICENSE) for the MIT license.
