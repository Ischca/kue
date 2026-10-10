import type { CropHandle } from "./crop";
import type { RecordingAvailability } from "./recordingAvailability";
import type { KueLocale } from "./types";

/** Japanese when it comes before English in the preferred languages; English otherwise. */
export function localeFromLanguages(languages: readonly unknown[]): KueLocale {
  for (const tag of languages) {
    if (typeof tag !== "string") continue;
    const language = tag.toLowerCase().split(/[-_]/u)[0];
    if (language === "ja") return "ja";
    if (language === "en") return "en";
  }
  return "en";
}

export interface KueText {
  /** KUE Cloud always creates an Issue. */
  createIssue: string;
  /** Only for untyped callers: the types require `submitLabel` with a custom handler. */
  send: string;
  /** An action that covers several findings. */
  count: (label: string, findings: number) => string;
  finding: {
    close: string; cancel: string; resetCropLabel: string; resetCrop: string;
    prompt: string; memoLabel: string; placeholder: string;
    openSaved: string; openSavedHint: string; add: string; addHint: string; withSavedHint: string;
    lockedNotice: string; fullNotice: string;
  };
  crop: { handles: Record<CropHandle, string>; expand: string; shrink: string; hint: string; value: (width: number, height: number) => string };
  review: {
    sendFailed: string; note: (toCloud: boolean) => string; destinationChanged: string; maybeSent: string;
    full: (toCloud: boolean) => string; title: (toCloud: boolean) => string; video: (seconds: string) => string;
    play: string; playFailed: string; image: (finding: number) => string; remove: string;
    sending: string; resend: string; back: string;
    discardAll: string; discardLocked: (toCloud: boolean) => string; discardUnlocked: string; cancel: string; discard: string;
  };
  menu: {
    recording: string; recordingLocked: string; outbox: string; close: string;
    unlockTitle: string; unlockBody: string; viewPlans: string; browserFailed: string;
  };
  trigger: {
    stopping: string; stop: string; reveal: string; capture: string;
    recordingHint: string; edgeHint: string; hint: (menu: boolean, findings: number) => string;
    actions: string; moveLeft: string; moveRight: string; moveUp: string; moveDown: string; hide: string;
  };
  recording: {
    messages: Record<Exclude<RecordingAvailability, "ready" | "upgrade">, string>;
    startFailed: string; stopFailed: string; heading: string; details: (seconds: string, mib: string) => string;
    memoLabel: string; placeholder: string; note: string; save: string; saveFailed: string; discard: string;
  };
  outbox: {
    loadFailed: string; sendFailed: string; title: string; close: string; note: string;
    sending: string; resend: string; empty: string; otherDestination: string; blocked: string; pending: string;
    deleteTitle: string; deleteBody: string; cancel: string; delete: string;
  };
  errors: {
    destinationLocked: string; queued: string; recordingNeedsCloud: string; recordingNeedsIndie: string;
    recordingUnavailable: string; destinationChanged: string; noGroupDestination: string;
    draftClosed: string; draftLocked: string; draftFull: string; mediaTotal: string; titleRequired: string;
    draftSending: string; mediaSize: string; outboxUnreadable: string; reportSending: string;
    reportDestination: string; reportChanged: string; imageSize: string; outboxFull: string;
    rebuild: string; previewFailed: string; screenshotTrigger: string;
  };
}

const ja: KueText = {
  createIssue: "Issueを作る",
  send: "送信",
  count: (label, findings) => `${label}（${findings}件）`,
  finding: {
    close: "KUEを閉じる",
    cancel: "キャンセル",
    resetCropLabel: "クロップ範囲を全画面に戻す",
    resetCrop: "範囲をリセット",
    prompt: "何を直したい？",
    memoLabel: "修正したい内容",
    placeholder: "例：プロフィールカードの左右paddingを広げる",
    openSaved: "保存した指摘を開く",
    openSavedHint: "この指摘を残したまま、保存した指摘の確認画面を開きます",
    add: "指摘を追加",
    addHint: "送信せずに端末へ保存し、あとでまとめて送ります",
    withSavedHint: "追加した指摘と合わせて、確認画面を開きます",
    lockedNotice: "保存した指摘の送信結果が確定していないため、この指摘は単独で送ります。保存した指摘を開いて再送しても、この指摘は消えません。",
    fullNotice: "指摘がすでに10件保存されているため、この指摘は単独で送ります。保存した指摘を開いても、この指摘は消えません。",
  },
  crop: {
    handles: {
      "north-west": "クロップ範囲の左上",
      "north-east": "クロップ範囲の右上",
      "south-west": "クロップ範囲の左下",
      "south-east": "クロップ範囲の右下",
    },
    expand: "範囲を広げる",
    shrink: "範囲を狭める",
    hint: "ドラッグ、または調整操作でクロップ範囲を変更します",
    value: (width, height) => `横 ${width}%、縦 ${height}%`,
  },
  review: {
    sendFailed: "送信できませんでした。",
    note: (toCloud) => `${toCloud ? "送信するまでCloudにはアップロードしません。" : "送信するまで、指摘を端末の外へ送りません。"}下書きはアプリを終了すると失われます。`,
    destinationChanged: "接続先が変更されています。元の設定に戻すか、この下書きを破棄してください。",
    maybeSent: "送信済みの可能性があります。同じ内容で再送して受付を確認します。",
    full: (toCloud) => `${toCloud ? "1つのIssueに入れられる" : "1回に送れる"}指摘は10件までです。新しい指摘を追加するには、どれかを削除してください。`,
    title: (toCloud) => (toCloud ? "Issueのタイトル" : "タイトル"),
    video: (seconds) => `画面録画 · ${seconds}秒 · 無音`,
    play: "動画を再生",
    playFailed: "動画を再生できませんでした。",
    image: (finding) => `指摘${finding}の画像`,
    remove: "この指摘を削除",
    sending: "送信中…",
    resend: "同じ内容で再送",
    back: "戻る",
    discardAll: "指摘をすべて破棄",
    discardLocked: (toCloud) => `端末の下書きを削除します。すでに受け付けられた場合、${toCloud ? "Issueの作成" : "送信"}は取り消されません。`,
    discardUnlocked: "保存した指摘と画像を端末から削除します。送信はしません。",
    cancel: "キャンセル",
    discard: "破棄",
  },
  menu: {
    recording: "画面録画",
    recordingLocked: "画面録画 · Indieで解放",
    outbox: "送信待ち",
    close: "閉じる",
    unlockTitle: "Indieで画面録画を解放",
    unlockBody: "画面録画はIndieプランで利用できます。スクリーンショットと、複数の指摘をまとめたIssueの作成はFreeでも利用できます。",
    viewPlans: "プランを確認",
    browserFailed: "ブラウザを開けませんでした。",
  },
  trigger: {
    stopping: "録画を停止中",
    stop: "録画を停止",
    reveal: "KUEボタンを表示",
    capture: "KUEで画面をキャプチャ",
    recordingHint: "タップで録画を停止し、確認画面を表示。ドラッグで移動できます",
    edgeHint: "タップで戻します。ドラッグでも移動できます",
    hint: (menu, findings) => `タップで撮影、ドラッグで移動。画面端で隠せます${menu ? "。長押し中にメニューを表示。スライドで選択、離して決定。アクセシビリティ操作から一覧も表示できます" : ""}${findings ? `。追加した指摘${findings}件` : ""}`,
    actions: "操作メニューを表示",
    moveLeft: "左へ移動",
    moveRight: "右へ移動",
    moveUp: "上へ移動",
    moveDown: "下へ移動",
    hide: "近くの端に隠す",
  },
  recording: {
    messages: {
      off: "録画は設定で無効になっています。利用するには録画設定をautoに変更し、アプリを再ビルドしてください。",
      cloud_required: "録画の利用にはKUE Cloudへの接続とIndieプランが必要です。",
      checking: "プランを確認しています。",
      check_failed: "プランを確認できませんでした。通信状態を確認して再試行してください。",
      unavailable: "現在、このCloudでは録画を利用できません。",
      rebuild: "録画を使うにはアプリの再ビルドが必要です。CLIで設定を更新してから再ビルドしてください。",
    },
    startFailed: "録画を開始できませんでした。",
    stopFailed: "録画を停止できませんでした。もう一度停止ボタンを押してください。",
    heading: "録画を確認",
    details: (seconds, mib) => `${seconds}秒 · ${mib}MiB · 無音`,
    memoLabel: "録画の指摘",
    placeholder: "指摘内容",
    note: "端末内の下書きに追加します。送信前にIssueのタイトルと指摘を確認できます。",
    save: "下書きに追加して確認",
    saveFailed: "追加できませんでした。",
    discard: "録画を破棄して戻る",
  },
  outbox: {
    loadFailed: "読み込みに失敗しました。",
    sendFailed: "送信に失敗しました。",
    title: "KUE · 送信待ち",
    close: "閉じる",
    note: "現在の送信先だけを再送します。保存から7日後、次の起動・確認時に削除されます。",
    sending: "送信中…",
    resend: "今すぐ再送",
    empty: "送信待ちはありません。",
    otherDestination: "別の送信先（再送しません）",
    blocked: "要確認",
    pending: "送信待ち",
    deleteTitle: "送信待ちを削除",
    deleteBody: "この端末に保存した画像とメモを削除します。取り消せません。",
    cancel: "キャンセル",
    delete: "削除",
  },
  errors: {
    destinationLocked: "接続先が変更されています。追加した指摘の送信先は変更できません。",
    queued: "端末に保存しました。接続後に再送します。",
    recordingNeedsCloud: "録画にはCloud接続とまとめの送信先が必要です。",
    recordingNeedsIndie: "画面録画はIndieプランで利用できます。",
    recordingUnavailable: "現在、このCloudでは録画を利用できません。",
    destinationChanged: "接続先が変更されています。元の設定に戻してください。",
    noGroupDestination: "まとめの送信先が設定されていません。",
    draftClosed: "この下書きは閉じられています。",
    draftLocked: "送信結果が確定するまで内容は変更できません。同じ内容で再送してください。",
    draftFull: "1回に送れる指摘は10件までです。",
    mediaTotal: "画像は1件10MiB、動画は1件20MiB、合計20MiBまでです。",
    titleRequired: "タイトル（200文字以内）と1件以上の指摘が必要です。",
    draftSending: "送信中の下書きは削除できません。",
    mediaSize: "画像は1件10MiB、動画は1件20MiBまでです。",
    outboxUnreadable: "KUEの送信待ちデータを読み込めませんでした。",
    reportSending: "送信中のレポートは削除できません。",
    reportDestination: "保存済みレポートの送信先を変更することはできません。",
    reportChanged: "保存済みレポートの内容が変わっています。新しいレポートとして送信してください。",
    imageSize: "保存する画像のサイズが不正です。",
    outboxFull: "KUEの送信待ちが上限です（10件・50MB）。送信待ちを送信または削除してください。",
    rebuild: "CLIで設定を更新し、アプリを再ビルドしてください。",
    previewFailed: "動画プレビューを開けませんでした。",
    screenshotTrigger: "KUE: スクリーンショット起動はAndroid 14以降で利用できます。写真アクセス権限は要求しません。",
  },
};

// The names match the English guide, which describes these screens.
const en: KueText = {
  createIssue: "Create Issue",
  send: "Send",
  count: (label, findings) => `${label} (${findings})`,
  finding: {
    close: "Close KUE",
    cancel: "Cancel",
    resetCropLabel: "Reset the crop to the full screen",
    resetCrop: "Reset crop",
    prompt: "What needs fixing?",
    memoLabel: "What needs fixing",
    placeholder: "e.g. Add more side padding to the profile card",
    // Short enough to sit beside Create Issue at 375pt.
    openSaved: "Saved findings",
    openSavedHint: "Opens the saved findings and keeps this one",
    add: "Add finding",
    addHint: "Saves it on this device to send later with others",
    withSavedHint: "Opens the confirmation with the saved findings",
    lockedNotice: "The saved findings have no confirmed send result yet, so this finding is sent on its own. Opening the saved findings to resend them keeps this finding.",
    fullNotice: "10 findings are already saved, so this finding is sent on its own. Opening the saved findings keeps this finding.",
  },
  crop: {
    handles: {
      "north-west": "Top-left corner of the crop",
      "north-east": "Top-right corner of the crop",
      "south-west": "Bottom-left corner of the crop",
      "south-east": "Bottom-right corner of the crop",
    },
    expand: "Expand the crop",
    shrink: "Shrink the crop",
    hint: "Drag, or use the adjust actions, to change the crop",
    value: (width, height) => `Width ${width}%, height ${height}%`,
  },
  review: {
    sendFailed: "Could not send.",
    note: (toCloud) => `${toCloud ? "Nothing is uploaded to Cloud until you send." : "Nothing leaves this device until you send."} The draft is lost when the app quits.`,
    destinationChanged: "The destination has changed. Restore the original settings or discard this draft.",
    maybeSent: "This may already have been sent. Resend the same content to confirm it was received.",
    full: (toCloud) => `${toCloud ? "An Issue can hold up to 10 findings." : "Up to 10 findings can be sent at once."} Remove one to add a new finding.`,
    title: (toCloud) => (toCloud ? "Issue title" : "Title"),
    video: (seconds) => `Screen recording · ${seconds} s · silent`,
    play: "Play video",
    playFailed: "Could not play the video.",
    image: (finding) => `Image of finding ${finding}`,
    remove: "Remove this finding",
    sending: "Sending…",
    resend: "Resend the same content",
    back: "Back",
    discardAll: "Discard all findings",
    discardLocked: (toCloud) => `Deletes the draft from this device. If it was already received, the ${toCloud ? "Issue" : "submission"} is not undone.`,
    discardUnlocked: "Deletes the saved findings and images from this device without sending them.",
    cancel: "Cancel",
    discard: "Discard",
  },
  menu: {
    recording: "Screen recording",
    recordingLocked: "Screen recording · Indie",
    outbox: "Pending reports",
    close: "Close",
    unlockTitle: "Unlock screen recording with Indie",
    unlockBody: "Screen recording is available on the Indie plan. Screenshots and Issues that group several findings are available on Free.",
    viewPlans: "View plans",
    browserFailed: "Could not open the browser.",
  },
  trigger: {
    stopping: "Stopping recording",
    stop: "Stop recording",
    reveal: "Show the KUE button",
    capture: "Capture the screen with KUE",
    recordingHint: "Tap to stop recording and review it. Drag to move it.",
    edgeHint: "Tap to bring it back. You can also drag it.",
    hint: (menu, findings) => `Tap to capture, drag to move, or drop at an edge to hide.${menu ? " Hold to open the menu, slide to an item and release to choose it, or open it as a list from the accessibility actions." : ""}${findings ? ` ${findings} saved ${findings === 1 ? "finding" : "findings"}.` : ""}`,
    actions: "Show actions menu",
    moveLeft: "Move left",
    moveRight: "Move right",
    moveUp: "Move up",
    moveDown: "Move down",
    hide: "Hide at the nearest edge",
  },
  recording: {
    messages: {
      off: "Recording is turned off. To use it, set recording to auto and rebuild the app.",
      cloud_required: "Recording needs a KUE Cloud connection and the Indie plan.",
      checking: "Checking the plan.",
      check_failed: "Could not check the plan. Check the connection and try again.",
      unavailable: "Recording is not available on this Cloud right now.",
      rebuild: "Recording needs an app rebuild. Update the setup with the CLI, then rebuild.",
    },
    startFailed: "Could not start recording.",
    stopFailed: "Could not stop recording. Press the stop button again.",
    heading: "Review recording",
    details: (seconds, mib) => `${seconds} s · ${mib} MiB · silent`,
    memoLabel: "Recording finding",
    placeholder: "What needs fixing",
    note: "Adds it to the draft on this device. You can review the Issue title and findings before sending.",
    save: "Add to draft and review",
    saveFailed: "Could not add it.",
    discard: "Discard recording and return",
  },
  outbox: {
    loadFailed: "Could not load the pending reports.",
    sendFailed: "Could not send.",
    title: "KUE · Pending reports",
    close: "Close",
    note: "Only reports for the current destination are resent. Reports are deleted 7 days after saving, at the next launch or check.",
    sending: "Sending…",
    resend: "Resend now",
    empty: "No pending reports.",
    otherDestination: "Other destination (not resent)",
    blocked: "Needs attention",
    pending: "Pending",
    deleteTitle: "Delete pending report",
    deleteBody: "Deletes the image and memo saved on this device. This cannot be undone.",
    cancel: "Cancel",
    delete: "Delete",
  },
  errors: {
    destinationLocked: "The destination has changed. Saved findings cannot be sent to another destination.",
    queued: "Saved on this device. It will be sent when the connection is back.",
    recordingNeedsCloud: "Recording needs a Cloud connection and a destination for grouped findings.",
    recordingNeedsIndie: "Screen recording is available on the Indie plan.",
    recordingUnavailable: "Recording is not available on this Cloud right now.",
    destinationChanged: "The destination has changed. Restore the original settings.",
    noGroupDestination: "No destination is set for grouped findings.",
    draftClosed: "This draft is closed.",
    draftLocked: "The content cannot change until the send result is confirmed. Resend the same content.",
    draftFull: "Up to 10 findings can be sent at once.",
    mediaTotal: "Images: 10 MiB each. Recordings: 20 MiB each. Total: 20 MiB.",
    titleRequired: "A title (up to 200 characters) and at least one finding are required.",
    draftSending: "A draft that is being sent cannot be deleted.",
    mediaSize: "Images: 10 MiB each. Recordings: 20 MiB each.",
    outboxUnreadable: "Could not read the KUE pending reports.",
    reportSending: "A report that is being sent cannot be deleted.",
    reportDestination: "A saved report cannot change its destination.",
    reportChanged: "The saved report has changed. Send it as a new report.",
    imageSize: "The image to save has an invalid size.",
    outboxFull: "KUE pending reports are full (10 reports, 50 MB). Send or delete pending reports.",
    rebuild: "Update the setup with the CLI and rebuild the app.",
    previewFailed: "Could not open the video preview.",
    screenshotTrigger: "KUE: The screenshot trigger needs Android 14 or later. It does not request photo access.",
  },
};

export function kueText(locale: KueLocale): KueText {
  return locale === "ja" ? ja : en;
}

const runtimeLocale = (): KueLocale => localeFromLanguages([Intl.DateTimeFormat().resolvedOptions().locale]);

// Errors raised outside the screens (drafts, the outbox, recording) follow the mounted Kue.
// Before it mounts, `fallback` decides. This module cannot import React Native, so it only knows
// the JS runtime's locale; callers that work without a mounted Kue pass deviceKueLocale.
let activeLocale: KueLocale | undefined;
export function setKueLocale(locale: KueLocale): void {
  activeLocale = locale;
}
export function currentKueText(fallback: () => KueLocale = runtimeLocale): KueText {
  if (activeLocale) return kueText(activeLocale);
  try {
    return kueText(fallback());
  } catch {
    return en;
  }
}
