import { Platform, Settings } from "react-native";
import { localeFromLanguages } from "./i18n";
import type { KueLocale } from "./types";

/** iOS reads the preferred languages themselves: Intl there follows the host app's own
 * localizations, so an app without Japanese reports en-JP on a Japanese device. Android's
 * Intl follows the device or per-app language. */
export function deviceKueLocale(): KueLocale {
  const languages: unknown[] = [];
  if (Platform.OS === "ios") {
    try {
      const preferred: unknown = Settings.get("AppleLanguages");
      if (Array.isArray(preferred)) languages.push(...preferred);
    } catch {
      // Fall back to Intl below.
    }
  }
  if (!languages.length) {
    try {
      languages.push(Intl.DateTimeFormat().resolvedOptions().locale);
    } catch {
      // English below.
    }
  }
  return localeFromLanguages(languages);
}
