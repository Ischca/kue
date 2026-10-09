// Run the full dependency audit. Only these reviewed Expo build-tool paths are
// accepted while upstream has no patched release. Any new path or advisory fails.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const reviewed = new Map([
  ["GHSA-86w9-cpqp-85rv", {
    module: "node-forge", version: "1.4.0", severity: "high", paths: new Set([
      "examples__expo>expo>@expo/cli>node-forge",
      "packages__react-native>expo>@expo/cli>node-forge",
    ]),
  }],
  ["GHSA-vfj7-8cjw-p6xm", {
    module: "braces", version: "3.0.3", severity: "high", paths: new Set([
      "examples__expo>expo>@expo/cli>@expo/metro-file-map>micromatch>braces",
      "examples__expo>expo>@expo/metro>metro-file-map>micromatch>braces",
      "packages__react-native>expo>@expo/metro>metro-file-map>micromatch>braces",
    ]),
  }],
]);

export function assessAudit(report) {
  if (!report || typeof report !== "object" || !report.advisories ||
    typeof report.advisories !== "object" || Array.isArray(report.advisories) ||
    !report.metadata?.vulnerabilities) throw new Error("Audit did not return a complete report.");
  const counts = { moderate: 0, high: 0, critical: 0 };
  const accepted = [];
  for (const advisory of Object.values(report.advisories)) {
    if (!Object.hasOwn(counts, advisory.severity)) continue;
    counts[advisory.severity]++;
    const exception = reviewed.get(advisory.github_advisory_id);
    if (!exception || advisory.severity !== exception.severity || advisory.module_name !== exception.module ||
      advisory.recommendation !== "None" || advisory.patched_versions !== "<0.0.0" ||
      !Array.isArray(advisory.findings) || advisory.findings.length === 0 ||
      advisory.findings.some(finding => finding.version !== exception.version ||
        !Array.isArray(finding.paths) || finding.paths.length === 0 ||
        finding.paths.some(p => !exception.paths.has(p)))) {
      throw new Error(`Unreviewed ${advisory.severity} advisory: ${advisory.github_advisory_id ?? advisory.module_name ?? "unknown"}`);
    }
    accepted.push(advisory.github_advisory_id);
  }
  for (const [severity, count] of Object.entries(counts)) {
    if (report.metadata.vulnerabilities[severity] !== count) {
      throw new Error(`Incomplete ${severity} advisory list in audit report.`);
    }
  }
  return accepted;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = spawnSync("pnpm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    console.error("Dependency audit could not complete.");
    process.exitCode = 1;
  } else {
    try {
      const accepted = assessAudit(JSON.parse(result.stdout));
      console.log(`Dependency audit complete: ${accepted.length} reviewed Expo build-tool advisories; no other moderate or higher findings.`);
      for (const id of accepted) console.log(`Reviewed: ${id}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
