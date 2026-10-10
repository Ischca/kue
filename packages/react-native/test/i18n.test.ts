import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupDraft } from "../src/groupDraft";
import { currentKueText, kueText, localeFromLanguages, setKueLocale } from "../src/i18n";

/** Every string a dictionary can produce, with each conditional branch taken. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const render = value as (...args: unknown[]) => unknown;
    return [render(true, 2), render(false, 1), render("Label", 3)].flatMap(strings);
  }
  return value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
}

afterEach(() => setKueLocale("ja"));

describe("display language", () => {
  it("is Japanese only when Japanese comes before English in the preferred languages", () => {
    expect(localeFromLanguages(["ja-JP", "en-JP"])).toBe("ja");
    expect(localeFromLanguages(["en-US", "ja-JP"])).toBe("en");
    expect(localeFromLanguages(["fr-FR", "ja-JP"])).toBe("ja");
    expect(localeFromLanguages(["ja_JP"])).toBe("ja");
    expect(localeFromLanguages(["JA"])).toBe("ja");
    expect(localeFromLanguages([42, "ja"])).toBe("ja");
    expect(localeFromLanguages(["fr-FR", "zh-Hans-JP"])).toBe("en");
    expect(localeFromLanguages([])).toBe("en");
  });

  it("writes every English string without Japanese, and leaves none empty", () => {
    const english = strings(kueText("en"));
    expect(english.length).toBeGreaterThan(100);
    expect(english.filter(text => /[぀-ヿ㐀-鿿＀-￯]/u.test(text))).toEqual([]);
    expect([...english, ...strings(kueText("ja"))].filter(text => !text.trim())).toEqual([]);
  });

  it("formats counts the way each language writes them", () => {
    expect(kueText("ja").count("Issueを作る", 3)).toBe("Issueを作る（3件）");
    expect(kueText("en").count("Create Issue", 3)).toBe("Create Issue (3)");
    expect(kueText("en").trigger.hint(false, 1)).toMatch(/ 1 saved finding\.$/u);
    expect(kueText("en").trigger.hint(true, 2)).toMatch(/ 2 saved findings\.$/u);
  });

  it("raises errors outside the screens in the language the mounted KUE set", async () => {
    const draft = new GroupDraft({ copy: report => ({ report, bytes: 1 }), release: () => undefined });
    setKueLocale("en");
    expect(currentKueText().errors.draftFull).toBe("Up to 10 findings can be sent at once.");
    await expect(draft.submit(" ", async () => undefined)).rejects.toThrow("A title (up to 200 characters) and at least one finding are required.");
    setKueLocale("ja");
    await expect(draft.submit(" ", async () => undefined)).rejects.toThrow("タイトル（200文字以内）と1件以上の指摘が必要です。");
  });

  it("uses the caller's device language before a KUE mounts, and English when that cannot be read", async () => {
    vi.resetModules();
    const fresh = await import("../src/i18n");
    expect(fresh.currentKueText(() => "ja").errors.draftFull).toBe("1回に送れる指摘は10件までです。");
    expect(fresh.currentKueText(() => "en").errors.draftFull).toBe("Up to 10 findings can be sent at once.");
    expect(fresh.currentKueText(() => { throw new Error("unavailable"); }).errors.draftFull).toBe("Up to 10 findings can be sent at once.");
    fresh.setKueLocale("ja");
    expect(fresh.currentKueText(() => "en").errors.draftFull).toBe("1回に送れる指摘は10件までです。");
  });
});
