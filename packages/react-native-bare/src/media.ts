import { getRuntime } from "./native";
import { fileUri } from "./models";
/** Copy only an exact URI from the currently awaited local callback. Keep the returned copy yourself. */
export async function copyKueMediaFile(uri: string): Promise<string> { return getRuntime().copyMediaFile(fileUri(uri)); }
/** Deletes only a retained copy previously created by this native SDK. */
export async function removeKueCopiedMediaFile(uri: string): Promise<void> { await getRuntime().removeCopiedMediaFile(fileUri(uri)); }
