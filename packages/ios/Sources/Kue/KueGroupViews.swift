#if canImport(UIKit)
import SwiftUI
import AVKit

struct KueGroupReview: View {
    @ObservedObject var controller: KueController
    let close: () -> Void
    @State private var title = ""
    @State private var error: KueError?
    @State private var confirmSend = false
    @State private var confirmDiscard = false
    @State private var preview: KueVideoReport?
    @State private var sendTask: Task<Void, Never>?
    @FocusState private var titleFocused: Bool
    var body: some View {
        // Read state before entering the clock closure so initial/edited titles invalidate this view.
        let submitDisabled = controller.groupSubmitting || !controller.groupDestinationValid || controller.savedFindings.isEmpty || (!controller.groupLocked && title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        let submitLabel = controller.groupSubmitting ? controller.text("送信中…", "Submitting…") : controller.groupLocked ? controller.text("同じ送信を再試行", "Retry the same submission") : controller.groupLabel + " (\(controller.savedFindings.count))"
        return NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(controller.text("保存した指摘をひとつの送信として確認します。", "Review saved findings as one submission."))
                    if controller.groupLocked { Text(controller.text("送信結果が未確定です。再試行は同じタイトル・画像・IDを使用します。", "The result is unknown. Retry keeps the same title, media and ID.")).font(.caption) }
                    if !controller.groupDestinationValid { Text(controller.text("送信先が変わっています。元の送信先に戻すか、破棄してください。", "The destination changed. Restore the original destination or discard.")).foregroundColor(.red) }
                    TextField(controller.text("タイトル（必須）", "Title (required)"), text: $title)
                        .focused($titleFocused)
                        .submitLabel(.done).onSubmit { titleFocused = false }
                        .textFieldStyle(.roundedBorder).disabled(controller.groupLocked || controller.groupSubmitting)
                        .accessibilityIdentifier("kue-group-title")
                    ForEach(Array(controller.savedFindings.enumerated()), id: \.element.clientReportId) { index, finding in
                        VStack(alignment: .leading, spacing: 8) {
                            Text("\(index + 1). " + finding.memo)
                            switch finding {
                            case .screenshot(let report):
                                if let image = UIImage(data: report.imageData) { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180).accessibilityLabel(controller.text("画像 \(index + 1)", "Image \(index + 1)")) }
                            case .video(let report):
                                Text(controller.text("録画", "Recording") + String(format: " · %.1fs · %.1f MiB", Double(report.durationMs)/1000, Double(report.videoData.count)/1048576))
                                Button(controller.text("再生", "Play")) { preview = report }.accessibilityIdentifier("kue-group-video-\(index)")
                            }
                            Button(controller.text("削除", "Remove")) {
                                do { try controller.removeSavedFinding(finding.clientReportId) } catch { self.error = error as? KueError ?? KueError(code: .invalidReport) }
                            }.disabled(controller.groupLocked || controller.groupSubmitting).accessibilityIdentifier("kue-group-remove-\(index)")
                        }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Color.secondary.opacity(0.08)).cornerRadius(12)
                    }
                    if let error {
                        Text(error.code == .localSaveFailed ? controller.text("ローカルに保存できませんでした。指摘を保持しています。", "Local save failed. The findings are retained.") : controller.text("送信できませんでした: ", "Submission failed: ") + error.code.rawValue)
                            .foregroundColor(.red).accessibilityIdentifier("kue-group-error")
                    }
                    TimelineView(.periodic(from: .now, by: 1)) { tick in
                        let countdown = KueRetryCountdown(deadline: controller.groupRetryAt, now: tick.date)
                        Button(submitLabel) { titleFocused = false; confirmSend = true }
                            .buttonStyle(.borderedProminent).disabled(submitDisabled || countdown.waiting)
                            .accessibilityIdentifier("kue-group-send")
                        if countdown.waiting { Text(countdown.exceedsOneDay ? controller.text("再試行まで1日以上", "Retry after more than one day") : controller.text("再試行まで \(countdown.seconds)秒", "Retry in \(countdown.seconds)s")).font(.caption) }
                    }
                    Button(controller.text("すべて破棄", "Discard all"), role: .destructive) { confirmDiscard = true }
                        .disabled(controller.groupSubmitting).accessibilityIdentifier("kue-group-discard")
                }.padding(20)
            }.navigationTitle(controller.text("保存した指摘", "Saved findings")).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) { Button(controller.text("戻る", "Back"), action: close).disabled(controller.groupSubmitting).accessibilityIdentifier("kue-group-back") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button(controller.text("完了", "Done")) { titleFocused = false }.accessibilityIdentifier("kue-keyboard-done") }
                }
        }.navigationViewStyle(.stack)
            .onAppear {
                if let prepared = controller.preparedGroupTitle { title = prepared }
                else if title.isEmpty { let first = controller.savedFindings.first?.memo.components(separatedBy: .newlines).first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) ?? ""
                    title = String(String.UnicodeScalarView(first.unicodeScalars.prefix(200))) }
            }
            .alert(controller.text("この内容を送信しますか？", "Submit these findings?"), isPresented: $confirmSend) {
                Button(controller.text("キャンセル", "Cancel"), role: .cancel) {}
                Button(controller.text("送信", "Submit")) {
                    sendTask = Task { do { try await controller.submitSavedFindings(title: title); close() }
                        catch { self.error = error is CancellationError ? KueError(code: .submissionCancelled, retryable: true) : error as? KueError ?? KueError(code: .networkError, retryable: true) } }
                }.accessibilityIdentifier("kue-group-confirm")
            } message: { Text(controller.text("\(controller.savedFindings.count)件をひとつの送信として送ります。", "Send \(controller.savedFindings.count) findings as one submission.")) }
            .alert(controller.text("保存した指摘を破棄しますか？", "Discard saved findings?"), isPresented: $confirmDiscard) {
                Button(controller.text("戻る", "Keep findings"), role: .cancel) {}
                Button(controller.text("破棄", "Discard"), role: .destructive) { try? controller.discardSavedFindings(); close() }
            } message: { Text(controller.groupLocked ? controller.text("サーバーですでに受け付けられている可能性があります。", "The server may already have accepted this submission.") : controller.text("保存した画像と録画を削除します。", "Saved images and recordings will be removed.")) }
            .sheet(isPresented: Binding(get: { preview != nil }, set: { if !$0 { preview = nil } })) {
                if let preview { KueVideoPreview(data: preview.videoData, locale: controller.locale) }
            }.onDisappear { sendTask?.cancel() }
    }
}

struct KueRecordingReview: View {
    @ObservedObject var controller: KueController
    let video: KueCapturedVideo, close: () -> Void
    @State private var memo = ""
    @State private var error: String?
    @State private var focused = false
    @State private var player: AVPlayer?
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(String(format: "%.1fs · %.1f MiB", Double(video.durationMs)/1000, Double(video.bytes)/1048576))
                    VideoPlayer(player: player).frame(height: 280).accessibilityIdentifier("kue-recording-preview")
                    Text(controller.text("メモ（必須）", "Memo (required)"))
                    KueMemoInput(text: $memo, focused: $focused, locale: controller.locale, identifier: "kue-recording-memo")
                        .frame(height: 100).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary)).id("recording-memo")
                    Text(controller.text("保存後にタイトルと送信内容を確認します。録画の保存だけでは送信しません。", "After saving, review the title and findings. Saving this recording does not upload it.")).font(.caption)
                    if let error { Text(controller.text("録画を保存できませんでした: ", "Could not save recording: ") + error).foregroundColor(.red) }
                    Button(controller.text("指摘に追加", "Add finding")) {
                        focused = false
                        do { try controller.saveRecording(memo: memo) } catch { self.error = (error as? KueError)?.code.rawValue ?? controller.text("保存に失敗しました", "Save failed") }
                    }.buttonStyle(.borderedProminent).disabled(memo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("kue-recording-save")
                    Button(controller.text("録画を破棄", "Discard recording"), role: .destructive, action: close).accessibilityIdentifier("kue-recording-discard")
                }.padding(20)
            }.navigationTitle(controller.text("録画を確認", "Review recording")).navigationBarTitleDisplayMode(.inline)
        }.navigationViewStyle(.stack).onAppear { if player == nil { player = AVPlayer(url: video.file) } }
            .onDisappear { player?.pause(); player = nil }
    }
}

struct KueVideoPreview: View {
    let data: Data, locale: KueLocale
    @Environment(\.dismiss) private var dismiss
    @State private var file: URL?
    @State private var player: AVPlayer?
    @State private var error = false
    var body: some View {
        NavigationView {
            Group { if let player { VideoPlayer(player: player).accessibilityIdentifier("kue-group-video-preview") } else { Text(error ? (locale == .ja ? "録画を再生できません" : "Could not play recording") : "…") } }
                .navigationTitle(locale == .ja ? "録画" : "Recording")
                .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button(locale == .ja ? "閉じる" : "Close") { dismiss() }.accessibilityIdentifier("kue-group-video-close") } }
        }.onAppear {
            do {
                let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("kue-previews", isDirectory: true)
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                let url = root.appendingPathComponent(UUID().uuidString + ".mp4"); try data.write(to: url, options: [.atomic])
                file = url; player = AVPlayer(url: url)
            } catch { self.error = true }
        }.onDisappear { player?.pause(); player = nil; if let file { try? FileManager.default.removeItem(at: file) } }
    }
}

struct KueOutboxView: View {
    @ObservedObject var controller: KueController
    let config: KueCloudConfiguration, close: () -> Void
    @State private var pending: [KuePendingReport] = []
    @State private var error: String?
    @State private var sending = false
    @State private var discardID: String?
    @State private var task: Task<Void, Never>?
    var body: some View {
        NavigationView {
            List {
                Text(controller.text("送信待ち: \(pending.count)件", "Pending: \(pending.count) reports")).accessibilityIdentifier("kue-outbox-count")
                Text(controller.text("画像のみ・10件 / 50 MiB / 7日。送信先の変更はできません。", "Images only: 10 reports / 50 MiB / 7 days. Destinations cannot be changed.")).font(.caption)
                if let error { Text(controller.text("送信待ちを処理できませんでした: ", "Could not process the outbox: ") + error).foregroundColor(.red).accessibilityIdentifier("kue-outbox-error") }
                ForEach(pending, id: \.clientReportId) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(String(item.clientReportId.prefix(8)))
                        Text(item.currentDestination ? controller.text(item.state == "blocked" ? "送信がブロックされています" : "送信待ち", item.state == "blocked" ? "Blocked" : "Pending") : controller.text("別の送信先・破棄のみ", "Different destination · discard only")).font(.caption)
                        Button(controller.text("破棄", "Discard"), role: .destructive) { discardID = item.clientReportId }.disabled(sending).accessibilityIdentifier("kue-outbox-discard-\(item.clientReportId)")
                    }
                }
                Button(controller.text("現在の送信先を再試行", "Retry current destination")) { retry() }
                    .disabled(sending || !pending.contains(where: \.currentDestination)).accessibilityIdentifier("kue-outbox-retry")
                Text(controller.text("手動の再試行は待機時間・ブロック状態を解除して試行します。", "Manual retry bypasses backoff and blocked state.")).font(.caption)
            }.navigationTitle(controller.text("送信待ち", "Outbox"))
                .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button(controller.text("閉じる", "Close"), action: close).disabled(sending).accessibilityIdentifier("kue-outbox-close") } }
        }.navigationViewStyle(.stack).task { await reload() }.onDisappear { task?.cancel() }
            .alert(controller.text("送信待ちを破棄しますか？", "Discard the pending report?"), isPresented: Binding(get: { discardID != nil }, set: { if !$0 { discardID = nil } })) {
                Button(controller.text("戻る", "Keep report"), role: .cancel) { discardID = nil }
                Button(controller.text("破棄", "Discard"), role: .destructive) {
                    if let id = discardID { Task { do { try await KueOutbox.shared.discard(id: id); await reload() } catch { self.error = (error as? KueError)?.code.rawValue } } }; discardID = nil
                }
            }
    }
    private func reload() async { do { pending = try await KueOutbox.shared.pending(config: config, includeOtherDestinations: true) } catch { self.error = (error as? KueError)?.code.rawValue } }
    private func retry() {
        sending = true; error = nil
        task = Task {
            defer { controller.manualOutboxTask = nil }
            do {
                try await KueOutbox.shared.retryPending(config: config, force: true,
                    active: { await MainActor.run { controller.isForeground } },
                    send: { [client = KueCloudClient(configuration: config, transport: controller.transport)] report in try await client.submit(report) },
                    onReceipt: { receipt in await MainActor.run { controller.onReceipt?(receipt) } },
                    onError: { failure in await MainActor.run { self.error = failure.code.rawValue } })
                await reload()
            } catch { self.error = (error as? KueError)?.code.rawValue }
            sending = false
        }
        controller.manualOutboxTask = task
    }
}
#endif
