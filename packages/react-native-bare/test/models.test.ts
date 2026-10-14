import { describe, expect, it } from "vitest";
import { call, decode, encode, errorFromNative, parse } from "../src/bridge";
import { context, features, finding, group, memo, normalizeCloud, pending, receipt, status } from "../src/models";
import { fixture } from "./fake";
const cloud = { apiBaseUrl: "https://kue.example.test", projectKey: "pk_example_fixture" };
describe("strict public metadata and native envelopes", () => {
  it("preserves ordered mixed image/video metadata, URI-only media and 200 Unicode codepoint titles", () => {
    const video = { clientReportId: "video_fixture_000001", memo: "video memo", context: fixture.context, capturedAt: fixture.capturedAt,
      video: { uri: "file:///app/callback/movie.mp4", width: 888, height: 1920, durationMs: 5897, byteSize: 15 * 1024 * 1024, mimeType: "video/mp4", capturedAt: fixture.capturedAt } };
    const result = group({ clientReportId: "group_fixture_000001", title: "😀".repeat(200), findings: [video, fixture] });
    expect(result.findings[0]).toMatchObject({ video: { durationMs: 5897, byteSize: 15 * 1024 * 1024 } });
    expect(result.findings[1]).toEqual(fixture); expect(Object.isFrozen(result.findings)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/base64|mediaBytes/);
    expect(() => group({ ...result, title: "😀".repeat(201) })).toThrow();
  });
  it("rejects memo/context overflow and invalid capture dimensions without weakening UTF-8 limits", () => {
    expect(memo("a".repeat(4096))).toHaveLength(4096);
    expect(() => memo("a".repeat(4097))).toThrow();
    expect(() => memo("bad\0memo")).toThrow();
    expect(() => context({ appVersion: "あ".repeat(43) })).toThrow();
    expect(context({ route: "/" + "a".repeat(2047) })).toEqual({ route: "/" + "a".repeat(2047) });
    expect(() => context({ expo: { updateId: "unused" } })).toThrow();
    expect(() => context({ platform: "ios" })).toThrow();
    expect(context({ platform: "ios" }, true)).toEqual({ platform: "ios" });
    expect(() => finding({ ...fixture, screenshot: { ...fixture.screenshot, width: 20000, height: 20000 } })).toThrow();
    expect(() => finding({ ...fixture, screenshot: { ...fixture.screenshot, uri: "data:image/png;base64,secret" } })).toThrow();
  });
  it("rejects NUL/newline group titles and preserves explicit repeated findings", () => {
    for (const title of ["bad\0title", "bad\nline"]) expect(() => group({ clientReportId: "group_fixture_000001", title, findings: [fixture] })).toThrow();
    expect(group({ clientReportId: "group_fixture_000001", title: "title", findings: [fixture, fixture] }).findings).toHaveLength(2);
  });
  it("requires strict receipt/features/status JSON types and matching status IDs", () => {
    const accepted = { clientReportId: fixture.clientReportId, id: "cloud_fixture_000001", status: "queued", receiptToken: "r".repeat(43) };
    expect(receipt(accepted)).toEqual(accepted);
    expect(() => receipt({ ...accepted, receiptToken: null })).toThrow();
    expect(() => features({ schemaVersion: 1, groups: 1, recording: { entitled: true, available: true } })).toThrow();
    expect(features({ schemaVersion: 1, groups: true, recording: { entitled: true, available: false } })).toEqual({ groups: true, recording: { entitled: true, available: false } });
    expect(() => status({ id: "wrong", status: "completed", githubIssue: null }, accepted.id)).toThrow();
    expect(() => status({ id: accepted.id, status: "completed", githubIssue: { number: "12", url: "https://github.com/example/project/issues/12" } }, accepted.id)).toThrow();
    expect(() => status({ id: accepted.id, status: "failed", githubIssue: null, error: null }, accepted.id)).toThrow();
  });
  it("keeps receipt-only status configuration independent of ingest project keys", () => {
    expect(normalizeCloud({ apiBaseUrl: cloud.apiBaseUrl }, false, true)).not.toHaveProperty("projectKey");
    expect(() => normalizeCloud({ apiBaseUrl: cloud.apiBaseUrl } as never, false)).toThrow();
  });
  it("permits HTTP only with both Debug and explicit loopback opt-in", () => {
    const loopback = { ...cloud, apiBaseUrl: "http://127.0.0.1:18793", allowDevelopmentLocalhostHttp: true };
    expect(normalizeCloud(loopback, true).apiBaseUrl).toBe(loopback.apiBaseUrl);
    for (const [config, dev] of [[loopback, false], [{ ...loopback, allowDevelopmentLocalhostHttp: false }, true], [{ ...loopback, apiBaseUrl: "http://10.0.2.2:18793" }, true], [{ ...cloud, apiBaseUrl: "https://key@kue.example.test" }, true], [{ ...cloud, apiBaseUrl: "https://kue.example.test/path" }, true]] as const) expect(() => normalizeCloud(config, dev)).toThrow();
  });
  it("parses IPv6 loopback without RN's incomplete global URL polyfill and canonicalizes default ports", () => {
    expect(normalizeCloud({ ...cloud, apiBaseUrl: "http://[::1]:18793/", allowDevelopmentLocalhostHttp: true }, true).apiBaseUrl).toBe("http://[::1]:18793");
    expect(normalizeCloud({ ...cloud, apiBaseUrl: "HTTPS://KUE.EXAMPLE.TEST:443/" }, false).apiBaseUrl).toBe(cloud.apiBaseUrl);
    for (const apiBaseUrl of ["https://", "https://bad..host", "https://[::::]", "https://example.test:70000", "https://example.test?", "https://example.test/#"]) expect(() => normalizeCloud({ ...cloud, apiBaseUrl }, true)).toThrow();
  });
  it("bounds JSON by UTF-8 size and rejects non-finite/cyclic payloads", () => {
    expect(() => encode({ memo: "😀".repeat(40000) })).toThrow();
    expect(() => encode({ context: { screenWidth: Infinity } })).toThrow();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle; expect(() => encode(cycle)).toThrow();
    for (const raw of ["[]", "null", '{"schemaVersion":2}', '{"schemaVersion":1,"ok":"true","value":null}', '{"schemaVersion":1,"ok":true}']) expect(() => decode(raw)).toThrow();
    expect(() => parse('{"schemaVersion":1,"value":1e400}')).toThrow();
  });
  it("preserves sanitized native HTTP retry metadata and rejects oversized numeric delays", async () => {
    expect(errorFromNative({ code: "upload_rejected", retryable: true, httpStatus: 503, serverCode: "fixture_retry", retryAfterSeconds: 1.5 })).toMatchObject({ status: 503, retryAfterMs: 1500, retryable: true });
    expect(() => errorFromNative({ code: "upload_rejected", retryable: true, retryAfterSeconds: 1e308 })).toThrow();
    await expect(call(async () => { throw { code: "request_cancelled", message: "file:///private/key" }; })).rejects.toMatchObject({ code: "request_cancelled", message: "KUE: request_cancelled" });
  });
  it("preserves known HTTP failure metadata when a native adapter disables unsafe delayed retry", async () => {
    const response = encode({ ok: false, error: { code: "upload_rejected", retryable: false, httpStatus: 503, serverCode: "fixture_retry" } });
    await expect(call(async () => response)).rejects.toMatchObject({
      code: "upload_rejected", retryable: false, status: 503, serverCode: "fixture_retry", retryAfterMs: undefined,
    });
  });
  it("never exposes outbox destination keys and rejects coerced bookkeeping", () => {
    const rows = pending([{ clientReportId: fixture.clientReportId, savedAt: "2026-10-12T01:00:00Z", state: "blocked", attempts: 2, nextAttemptAt: 0, currentDestination: false, destination: "pk_private_fixture" }]);
    expect(rows[0]).toMatchObject({ attempts: 2, currentDestination: false, nextAttemptAt: 0 }); expect(JSON.stringify(rows)).not.toContain("pk_private");
    expect(() => pending([{ ...rows[0], attempts: "2" }])).toThrow();
  });
});
