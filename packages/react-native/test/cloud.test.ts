import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("expo/fetch", () => ({ fetch: mocks.fetch }));
vi.mock("expo-file-system", () => ({
  File: class MockExpoFile extends Blob {
    readonly name: string;
    readonly uri: string;

    constructor(uri: string) {
      super(["jpeg bytes"], { type: "image/jpeg" });
      this.name = "capture.jpg";
      this.uri = uri;
    }
  },
}));

import {
  KueCloudError,
  normalizeKueCloudConfig,
  submitKueReport,
  getKueReportStatus,
} from "../src/cloud";
import type { KueCloudConfig, KueLocalReport } from "../src/types";

const cloud: KueCloudConfig = {
  apiBaseUrl: "https://reports.example.test/",
  projectKey: "pk_12345678",
};

const report: KueLocalReport = {
  clientReportId: "kue_client_12345",
  memo: "profile padding",
  crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
  screenshot: {
    uri: "file:///crop.jpg",
    width: 500,
    height: 600,
    mimeType: "image/jpeg",
  },
  sourceSize: { width: 1_000, height: 1_000 },
  context: { platform: "ios", route: "/profile" },
  capturedAt: "2026-08-20T00:00:00.000Z",
};

describe("KUE Cloud configuration", () => {
  it("normalizes an origin and appends the report path", () => {
    expect(normalizeKueCloudConfig(cloud, false)).toEqual({
      endpoint: "https://reports.example.test/v1/reports",
      projectKey: "pk_12345678",
      timeoutMs: 15_000,
    });
  });

  it("allows insecure HTTP only in development", () => {
    const local = { ...cloud, apiBaseUrl: "http://127.0.0.1:8787" };

    expect(normalizeKueCloudConfig(local, true).endpoint).toBe(
      "http://127.0.0.1:8787/v1/reports",
    );
    expect(() => normalizeKueCloudConfig(local, false)).toThrowError(KueCloudError);
  });

  it.each([
    [{ ...cloud, projectKey: "pk_short" }, "projectKey"],
    [{ ...cloud, apiBaseUrl: "https://reports.example.test/base" }, "origin"],
    [{ ...cloud, timeoutMs: 0 }, "timeoutMs"],
    [{ ...cloud, timeoutMs: 120_001 }, "timeoutMs"],
    [{ ...cloud, timeoutMs: 10.5 }, "timeoutMs"],
  ] as const)("rejects an invalid config", (value, message) => {
    expect(() => normalizeKueCloudConfig(value, false)).toThrowError(message);
  });
});

describe("submitKueReport", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
  });

  it.each([301, 302, 303, 307, 308])("rejects redirect responses (%s) for uploads and receipt reads", async (status) => {
    mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      expect(init).toMatchObject({ redirect: "error", credentials: "omit" });
      return new Response(null, { status, headers: { Location: "https://unexpected.test/steal" } });
    });
    await expect(submitKueReport(report, cloud)).rejects.toMatchObject({ code: "upload_rejected", retryable: false, status });
    await expect(getKueReportStatus({ id: "report_123", receiptToken: "a".repeat(43) }, cloud))
      .rejects.toMatchObject({ code: "unexpected_response", retryable: false, status });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls.every(([url]) => url.startsWith(cloud.apiBaseUrl))).toBe(true);
  });

  it("preserves the receipt token and uses it, not the project key, for status", async () => {
    const receiptToken = "a".repeat(43);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: "report_123", status: "queued", receiptToken }), { status: 202 }));
    const receipt = await submitKueReport(report, cloud);
    expect(receipt.receiptToken).toBe(receiptToken);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: receipt.id, status: "completed", githubIssue: { number: 1, url: "https://github.com/owner/repo/issues/1" } })));
    expect((await getKueReportStatus(receipt, cloud)).status).toBe("completed");
    expect(mocks.fetch.mock.calls[1]?.[1].headers.Authorization).toBe(`Bearer ${receiptToken}`);
    expect(mocks.fetch.mock.calls[1]?.[1]).toMatchObject({ redirect: "error", credentials: "omit" });
  });

  it("supports pending status and rejects missing capabilities or foreign issue URLs", async () => {
    const receipt = { id: "report_123", receiptToken: "a".repeat(43) };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: receipt.id, status: "queued", githubIssue: null })));
    expect((await getKueReportStatus(receipt, cloud)).githubIssue).toBeNull();
    await expect(getKueReportStatus({ id: receipt.id }, cloud)).rejects.toMatchObject({ code: "invalid_report" });
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: receipt.id, status: "completed", githubIssue: { number: 1, url: "https://evil.test/issues/1" } })));
    await expect(getKueReportStatus(receipt, cloud)).rejects.toMatchObject({ code: "unexpected_response" });
  });

  it.each(["short", "a".repeat(15), "a".repeat(129), "unsafe id with spaces"])(
    "rejects an invalid clientReportId before network access",
    async (clientReportId) => {
      await expect(submitKueReport({ ...report, clientReportId }, cloud)).rejects.toMatchObject({
        code: "invalid_report",
        retryable: false,
      });
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["a".repeat(16), "a".repeat(128)])(
    "accepts a clientReportId at the length boundary",
    async (clientReportId) => {
      mocks.fetch.mockResolvedValue(
        new Response(JSON.stringify({ id: "report_123", status: "received" }), { status: 202 }),
      );

      await expect(submitKueReport({ ...report, clientReportId }, cloud)).resolves.toMatchObject({
        clientReportId,
      });
    },
  );

  it.each(["received", "queued"] as const)("accepts a 202 %s receipt", async (status) => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "report_123", status }), {
        headers: { "content-type": "application/json" },
        status: 202,
      }),
    );

    await expect(submitKueReport(report, cloud)).resolves.toEqual({
      clientReportId: "kue_client_12345",
      id: "report_123",
      status,
    });

    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://reports.example.test/v1/reports");
    expect(init.method).toBe("POST");
    expect(init).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(init.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer pk_12345678",
      "Idempotency-Key": "kue_client_12345",
    });
    expect(init.headers).not.toHaveProperty("Content-Type");

    const body = init.body as FormData;
    expect(body.get("memo")).toBe("profile padding");
    expect(body.get("screenshot")).toBeInstanceOf(Blob);
    expect(JSON.parse(String(body.get("metadata")))).toEqual({
      schemaVersion: 1,
      context: { platform: "ios", route: "/profile" },
      capture: {
        capturedAt: "2026-08-20T00:00:00.000Z",
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
        sourceSize: { width: 1_000, height: 1_000 },
        outputSize: { width: 500, height: 600 },
        mimeType: "image/jpeg",
      },
    });
    expect(String(body.get("metadata"))).not.toContain("kue_client_12345");
  });

  it("surfaces rate limits as retryable typed errors", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "rate_limited" } }), {
        headers: { "content-type": "application/json", "retry-after": "2" },
        status: 429,
      }),
    );

    await expect(submitKueReport(report, cloud)).rejects.toMatchObject({
      code: "upload_rejected",
      retryAfterMs: 2_000,
      retryable: true,
      serverCode: "rate_limited",
      status: 429,
    });
  });

  it("treats an exhausted project quota as non-retryable", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "quota_exceeded" } }), {
        headers: { "content-type": "application/json" },
        status: 429,
      }),
    );

    await expect(submitKueReport(report, cloud)).rejects.toMatchObject({
      code: "upload_rejected",
      message: "The KUE monthly report quota has been reached.",
      retryable: false,
      serverCode: "quota_exceeded",
      status: 429,
    });
  });

  it.each([
    [403, "project_plan_paused", "This project is paused on KUE Free. Select it in the dashboard or upgrade to Indie."],
    [409, "storage_quota_exceeded", "KUE image storage is full. Free space in the dashboard or upgrade from Free to Indie."],
  ])("does not retry plan/storage rejection %s %s automatically", async (status, serverCode, message) => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { code: serverCode } }), {
      status: Number(status), headers: { "content-type": "application/json" },
    }));
    await expect(submitKueReport(report, cloud)).rejects.toMatchObject({ status: Number(status), serverCode, message, retryable: false });
  });

  it("falls back safely when a rejection body is malformed", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("not json", {
        headers: { "content-type": "text/plain" },
        status: 429,
      }),
    );

    await expect(submitKueReport(report, cloud)).rejects.toMatchObject({
      code: "upload_rejected",
      retryable: true,
      serverCode: undefined,
      status: 429,
    });
  });

  it("rejects malformed 202 receipts without treating them as success", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "report_123", status: "completed" }), {
        status: 202,
      }),
    );

    await expect(submitKueReport(report, cloud)).rejects.toMatchObject({
      code: "unexpected_response",
      retryable: true,
      status: 202,
    });
  });

  it("aborts at timeout and returns a retryable error", async () => {
    mocks.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    await expect(submitKueReport(report, { ...cloud, timeoutMs: 1 })).rejects.toMatchObject({
      code: "request_timeout",
      retryable: true,
    });
  });

  it("keeps the timeout active while reading the 202 receipt body", async () => {
    mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => ({
      headers: new Headers(),
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("body aborted")));
        }),
      status: 202,
    }));

    await expect(submitKueReport(report, { ...cloud, timeoutMs: 1 })).rejects.toMatchObject({
      code: "request_timeout",
      retryable: true,
    });
  });
});
