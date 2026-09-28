const UINT32_RANGE = 0x1_0000_0000;

function randomHex(): string {
  return Math.floor(Math.random() * UINT32_RANGE)
    .toString(16)
    .padStart(8, "0");
}

/** Creates a non-secret identifier used only to deduplicate report creation. */
export function createClientReportId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `kue_${uuid}`;

  return `kue_${Date.now().toString(36)}_${randomHex()}${randomHex()}${randomHex()}${randomHex()}`;
}
