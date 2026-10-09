import type { KueFinding } from "./types";

export const findingMedia = (report: KueFinding) => "video" in report ? report.video : report.screenshot;
export const findingLimit = (report: KueFinding) => ("video" in report ? 20 : 10) * 1024 * 1024;
export function withFindingUri(report: KueFinding, uri: string): KueFinding {
  return "video" in report ? { ...report, video: { ...report.video, uri } } : { ...report, screenshot: { ...report.screenshot, uri } };
}
