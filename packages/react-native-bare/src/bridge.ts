import type { KueCloudErrorCode } from "./types";

export interface BridgeRequest { sessionId: string; requestId: string; kind: string; payload: string }
export interface BridgeEvent { sessionId: string; kind: string; payload: string }
export interface NativeABI {
  attach(sessionId: string, configuration: string): Promise<string>;
  update(sessionId: string, configuration: string): Promise<string>;
  detach(sessionId: string): Promise<string>;
  execute(sessionId: string, action: string, args: string): Promise<string>;
  completeCallback(sessionId: string, requestId: string, response: string): void;
  standalone(action: string, args: string): Promise<string>;
  copyMediaFile(sessionId: string, requestId: string, uri: string): Promise<string>;
  removeCopiedMediaFile(uri: string): Promise<string>;
  onRequest(listener: (request: BridgeRequest) => void): { remove(): void };
  onEvent(listener: (event: BridgeEvent) => void): { remove(): void };
}
export interface RecorderABI { install(sessionId: string): Promise<string>; remove(sessionId: string): Promise<string> }
export class KueCloudError extends Error {
  readonly code: KueCloudErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly serverCode?: string;
  readonly retryAfterMs?: number;
  constructor(code: KueCloudErrorCode, options: { retryable?: boolean; status?: number; serverCode?: string; retryAfterMs?: number } = {}) {
    super(`KUE: ${code}`);
    this.name = "KueCloudError";
    this.code = code; this.retryable = options.retryable ?? false;
    this.status = options.status; this.serverCode = options.serverCode; this.retryAfterMs = options.retryAfterMs;
  }
}
export const fail = (code: KueCloudErrorCode): never => { throw new KueCloudError(code); };
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("unexpected_response");
  return value as Record<string, unknown>;
};
export const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:~-]{1,128}$/.test(value)) return fail("invalid_config");
  return value;
};
export function utf8Size(value: string): number {
  let size = 0;
  for (const char of value) { const point = char.codePointAt(0)!; size += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4; }
  return size;
}
function finiteJSON(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 24) fail("invalid_config");
  if (typeof value === "number" && !Number.isFinite(value)) fail("invalid_config");
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") fail("invalid_config");
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) fail("invalid_config");
  seen.add(value);
  for (const child of Object.values(value)) finiteJSON(child, seen, depth + 1);
  seen.delete(value);
}
export function encode(value: Record<string, unknown>): string {
  const body = { ...value, schemaVersion: 1 };
  finiteJSON(body);
  const json = JSON.stringify(body);
  if (utf8Size(json) > 128 * 1024) fail("invalid_config");
  return json;
}
export function parse(json: string): Record<string, unknown> {
  if (typeof json !== "string" || utf8Size(json) > 128 * 1024) return fail("unexpected_response");
  try {
    const result = object(JSON.parse(json));
    finiteJSON(result);
    if (result.schemaVersion !== 1) return fail("unexpected_response");
    return result;
  } catch { return fail("unexpected_response"); }
}
export function errorFromNative(value: unknown): KueCloudError {
  const body = object(value);
  if (typeof body.code !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(body.code) || typeof body.retryable !== "boolean") return fail("unexpected_response");
  const status = body.httpStatus;
  const server = body.serverCode;
  const seconds = body.retryAfterSeconds;
  if (status !== undefined && (!Number.isInteger(status) || Number(status) < 100 || Number(status) > 599)) return fail("unexpected_response");
  if (server !== undefined && (typeof server !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(server))) return fail("unexpected_response");
  if (seconds !== undefined && (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > Number.MAX_SAFE_INTEGER / 1000)) return fail("unexpected_response");
  return new KueCloudError(body.code, { retryable: body.retryable, status: status as number | undefined, serverCode: server as string | undefined, retryAfterMs: seconds === undefined ? undefined : (seconds as number) * 1000 });
}
export function decode(json: string): unknown {
  const body = parse(json);
  if (body.ok === false) throw errorFromNative(body.error);
  if (body.ok !== true || !Object.hasOwn(body, "value")) return fail("unexpected_response");
  return body.value;
}
export async function call(operation: () => Promise<string>): Promise<unknown> {
  try { return decode(await operation()); }
  catch (error) {
    if (error instanceof KueCloudError) throw error;
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    throw new KueCloudError(code === "request_cancelled" ? code : "unexpected_response", { retryable: code === "request_cancelled" });
  }
}
export function safeObserve(callback: (() => unknown) | undefined): void {
  if (!callback) return;
  try { Promise.resolve(callback()).catch(() => {}); } catch { /* Observers cannot change accepted native state. */ }
}
let sequence = 0;
export function uniqueId(prefix: string): string { return `${prefix}_${Date.now().toString(36)}_${(++sequence).toString(36)}_${Math.random().toString(36).slice(2, 12)}`; }
