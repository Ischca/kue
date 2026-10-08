import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { resolveAppDirectory } from "./app-directory.mjs";
import { parseManagedConfig } from "./setup-state.mjs";
import { checkCloudConfig, cloudConfigFromEnvironment, validateCheckConfig } from "./check-client.mjs";

export async function check(argv, cwd = process.cwd(), { env = process.env, request = fetch, log = console.log } = {}) {
  let values;
  try {
    const parsed = parseArgs({ args: argv, strict: true, options: {
      help: { type: "boolean", short: "h" }, app: { type: "string" }, config: { type: "string" }, env: { type: "boolean" },
    } });
    values = parsed.values;
  } catch { throw new Error("Invalid check options. Run kue-qa check --help. Do not pass keys as command-line arguments."); }
  if (values.help) { log("kue-qa check [--app DIRECTORY | --config project.json | --env]\nRead-only Cloud admission check; exits nonzero when rejected or unverified.\n--env uses the already-resolved EXPO_PUBLIC_KUE_* environment, without loading dotenv.\nWithout --env/--config, reads the selected Expo app's .kue/config.js as data.\nNo authorization, uploads, installs or file writes. Run again immediately before distribution."); return; }
  if ([values.app !== undefined, values.config !== undefined, Boolean(values.env)].filter(Boolean).length > 1) throw new Error("Choose only one of --app, --config, or --env.");
  let config;
  if (values.env) config = cloudConfigFromEnvironment(env);
  else if (values.config !== undefined) {
    try { config = validateCheckConfig(JSON.parse(await readFile(path.resolve(cwd, values.config), "utf8"))); }
    catch { throw new Error("Cannot read a valid JSON configuration. Use dashboard configuration; file contents were not executed."); }
  } else {
    const selected = await resolveAppDirectory(cwd, values.app);
    try { config = parseManagedConfig(await readFile(path.join(selected.directory, ".kue/config.js"), "utf8"), validateCheckConfig); }
    catch { throw new Error("Cannot read managed .kue/config.js. Restore it or use --config/--env for a manual integration."); }
  }
  if (config === null) { log("KUE check skipped: explicitly disabled or device-only mode."); return; }
  await checkCloudConfig(config, { request });
  log("KUE Cloud admission check passed. No report was sent. This is a point-in-time check, not an end-to-end delivery guarantee.");
}
