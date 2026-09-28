# KUE CLI

Connect an Expo SDK 54–57 app to KUE Cloud. Node 22.13+ is required.

```sh
npx kue-qa@beta init --server https://YOUR-KUE-HOST
```

Run from the Expo package, including in a monorepo. The CLI detects your GitHub
remote, opens browser consent, installs the SDK/native dependencies, and adds KUE
to the default React component. It preserves loading returns and nested callbacks.
Review the diff. Unsupported component patterns fail without editing your root;
in that case add `<Kue cloud={...} />` manually. KUE is development-only by default.

`--dry-run` previews detection without writes or network. `--root` and
`--repository` override detection. `--no-open` prints the consent link.
`--skip-install` is for managed dependency workflows. `--config project.json`
accepts dashboard configuration instead of browser authorization. `--sdk sdk.tgz`
installs a locally packed SDK; yalc is not required.

`.kue/config.js` contains only a public create-only key and can be committed.
`.kue/backup-*.txt` contains the original app source and must remain local.
The CLI never stores GitHub user tokens or billing credentials in your app.

To update: install the desired `@kue-qa/react-native` version with your package
manager. `init` is idempotent and can refresh server configuration. There is no
automatic SDK update or runtime dependency on this CLI.

The hosted domain and npm publication must be configured by the service operator
before the first public release. The examples above do not imply availability.
