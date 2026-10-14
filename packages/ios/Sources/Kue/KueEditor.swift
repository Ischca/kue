#if canImport(UIKit)
import UIKit
import SwiftUI

@MainActor final class KueEditorModel: ObservableObject {
    let image: UIImage
    let context: KueReportContext
    let destination: KueDestination
    let locale: KueLocale
    let capturedAt: Date
    let reportToken: UUID?
    let onReceipt: ((KueReceipt) -> Void)?
    let onError: ((KueError) -> Void)?
    @Published var crop = KueCrop.full
    @Published var memo: String
    @Published var sending = false
    @Published var error: KueError?
    @Published var prepared: KueReport?
    @Published var retryDeadline: Date?
    @Published var completed = false
    private var uploadTask: Task<Void, Never>?
    init(image: UIImage, memo: String, context: KueReportContext, destination: KueDestination,
         locale: KueLocale, onReceipt: ((KueReceipt) -> Void)?, onError: ((KueError) -> Void)?, capturedAt: Date = Date(), reportToken: UUID? = nil) {
        self.image = image; self.memo = memo; self.context = context; self.destination = destination
        self.locale = locale; self.onReceipt = onReceipt; self.onError = onError
        self.capturedAt = capturedAt; self.reportToken = reportToken
    }
    var isValidMemo: Bool {
        let trimmed = memo.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && !trimmed.contains("\0") && trimmed.utf8.count <= 4096
    }
    weak var controller: KueController?
    @Published var queued = false
    @Published var saved = false
    @Published var showSaved = false
    func prepareReport() throws -> KueReport {
        if let prepared { return prepared }
        guard let source = image.cgImage else { throw KueError(code: .captureFailed) }
        let rect = CGRect(x: crop.x * Double(source.width), y: crop.y * Double(source.height),
            width: crop.width * Double(source.width), height: crop.height * Double(source.height)).integral
            .intersection(CGRect(x: 0, y: 0, width: source.width, height: source.height))
        guard let cropped = source.cropping(to: rect), let bytes = UIImage(cgImage: cropped).pngData() else { throw KueError(code: .captureFailed) }
        let actualCrop = KueCrop(x: rect.minX / Double(source.width), y: rect.minY / Double(source.height),
            width: min(rect.width / Double(source.width), 1 - rect.minX / Double(source.width)),
            height: min(rect.height / Double(source.height), 1 - rect.minY / Double(source.height)))
        let report = try KueReport(memo: memo, crop: actualCrop, imageData: bytes,
            sourceSize: KueImageSize(width: source.width, height: source.height),
            outputSize: KueImageSize(width: cropped.width, height: cropped.height), context: context, capturedAt: capturedAt)
        prepared = report; return report
    }
    func addFinding() {
        do {
            guard let controller else { throw KueError(code: .invalidConfig) }
            try controller.addFinding(.screenshot(prepareReport())); saved = true; completed = true
            controller.finishReport(reportToken, outcome: .findingAdded)
        } catch { self.error = error as? KueError ?? KueError(code: .invalidReport); onError?(self.error!) }
    }
    func submit() {
        guard !sending, isValidMemo, !completed, retryDeadline == nil || retryDeadline! <= Date() else { return }
        sending = true; error = nil
        uploadTask = Task { [weak self] in
            guard let self else { return }
            do {
                let report = try prepareReport(); try Task.checkCancellation()
                guard let controller else { throw KueError(code: .invalidConfig) }
                if !controller.savedFindings.isEmpty && !controller.groupLocked && !controller.groupFull {
                    try controller.addFinding(.screenshot(report)); saved = true; completed = true; showSaved = true
                } else {
                    queued = try await controller.deliverSingle(report, destination: destination)
                    completed = true
                }
                controller.finishReport(reportToken, outcome: queued ? .queued : saved ? .findingAdded : .submitted)
            } catch {
                let failure = Task.isCancelled || error is CancellationError ? KueError(code: .submissionCancelled, retryable: true) :
                    error as? KueError ?? KueError(code: .networkError, retryable: true)
                self.error = failure; retryDeadline = failure.retryAfter.map { Date().addingTimeInterval($0) }; onError?(failure)
            }
            sending = false
        }
    }
    func cancelUpload() { uploadTask?.cancel() }
    func edit() { prepared = nil; error = nil; retryDeadline = nil }
    func text(_ ja: String, _ en: String) -> String { locale == .ja ? ja : en }
}

struct KueEditor: View {
    @ObservedObject var model: KueEditorModel
    @ObservedObject var controller: KueController
    let close: () -> Void
    @State private var confirmDiscard = false
    @State private var memoFocused = false
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(model.text("範囲を選択し、内容を入力", "Select a region and enter a memo")).font(.headline)
                    Text(model.text("枠をドラッグして移動。四隅で大きさを変更。", "Drag the rectangle to move it. Drag a corner to resize."))
                        .font(.caption).foregroundColor(.secondary)
                    KueCropView(image: model.image, crop: $model.crop, locked: model.prepared != nil, locale: model.locale)
                        .frame(height: 320).accessibilityElement(children: .contain)
                    Text(model.text("メモ（必須・最大4 KiB）", "Memo (required, maximum 4 KiB)"))
                    KueMemoInput(text: $model.memo, focused: $memoFocused, disabled: model.prepared != nil, locale: model.locale, identifier: "kue-memo-input").frame(height: 100).padding(8)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.4)))
                        .id("capture-memo")
                    if let error = model.error {
                        Text(errorText(error)).foregroundColor(.red).font(.callout)
                            .accessibilityIdentifier("kue-submit-error")
                        if model.prepared != nil {
                            Text(model.text("再試行では同じ画像と送信IDを使用します。編集すると新しいレポートになります。",
                                            "Retry uses the same image and submission ID. Editing creates a new report."))
                                .font(.caption).foregroundColor(.secondary)
                            Button(model.text("編集する", "Edit report")) { model.edit() }.disabled(model.sending)
                        }
                    }
                    if !controller.savedFindings.isEmpty {
                        if controller.groupLocked || controller.groupFull {
                            Text(controller.groupLocked ? model.text("保存した指摘は送信結果が未確定です。この画像は別のレポートとして送信されます。", "The saved group's result is unknown. This capture submits separately.") : model.text("保存した指摘は10件です。この画像は別のレポートとして送信されます。", "The saved group has 10 findings. This capture submits separately.")).font(.caption)
                        }
                        Button(model.text("保存した指摘を開く", "Open saved findings") + " (\(controller.savedFindings.count))") { model.showSaved = true }
                            .accessibilityIdentifier("kue-open-saved")
                    }
                    if !model.completed && controller.groupAvailable {
                        Button(model.text("指摘を追加", "Add finding")) { memoFocused = false; model.addFinding() }
                            .disabled(model.sending || !model.isValidMemo || controller.groupLocked || controller.groupFull)
                            .accessibilityIdentifier("kue-add-finding")
                    }
                    if model.completed {
                        Text(model.queued ? model.text("送信待ちに保存しました。", "Saved to the outbox.") : model.saved ? model.text("指摘を追加しました。送信前に保存した指摘を確認してください。", "Finding saved. Review saved findings before submitting.") : model.text("送信先が受け付けました。", "The destination accepted the report."))
                            .foregroundColor(.green).accessibilityIdentifier("kue-submit-success")
                        Button(model.text("閉じる", "Close"), action: close).buttonStyle(.borderedProminent)
                    } else {
                        TimelineView(.periodic(from: .now, by: 1)) { timeline in
                            let countdown = KueRetryCountdown(deadline: model.retryDeadline, now: timeline.date)
                            Button {
                                memoFocused = false
                                model.submit()
                            } label: {
                                HStack {
                                    if model.sending { ProgressView().tint(.white) }
                                    Text(countdown.exceedsOneDay ? model.text("再試行まで1日以上", "Retry after more than one day") :
                                            countdown.waiting ? model.text("再試行まで \(countdown.seconds)秒", "Retry in \(countdown.seconds)s") : submitLabel)
                                        .frame(maxWidth: .infinity)
                                }.padding(.vertical, 6)
                            }.buttonStyle(.borderedProminent)
                                .disabled(model.sending || !model.isValidMemo || countdown.waiting || model.error?.retryable == false)
                                .accessibilityIdentifier("kue-send")
                        }
                    }
                }.padding(20)
            }.navigationTitle("KUE").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button(model.text("キャンセル", "Cancel")) {
                            if model.prepared != nil && !model.completed { confirmDiscard = true } else { close() }
                        }.disabled(model.sending).accessibilityIdentifier("kue-cancel")
                    }
                }.alert(model.text("レポートを破棄しますか？", "Discard this report?"), isPresented: $confirmDiscard) {
                    Button(model.text("破棄", "Discard"), role: .destructive, action: close)
                    Button(model.text("戻る", "Keep report"), role: .cancel) {}
                } message: {
                    Text(model.text("送信がタイムアウトした場合、サーバーですでに受け付けられている可能性があります。",
                                    "After a timeout, the server may already have accepted this report."))
                }
        }.navigationViewStyle(.stack).interactiveDismissDisabled(model.sending)
            .sheet(isPresented: $model.showSaved) { KueGroupReview(controller: controller) { model.showSaved = false } }
    }
    private var submitLabel: String {
        if model.prepared != nil { return model.text("再試行", "Retry") }
        if !controller.savedFindings.isEmpty && !controller.groupLocked && !controller.groupFull {
            return controller.groupLabel + " (\(controller.savedFindings.count + 1))"
        }
        switch model.destination {
        case .local(let label, _): return label
        case .cloud: return model.text("Issueを作る", "Create Issue")
        }
    }
    private func errorText(_ error: KueError) -> String {
        let description: String
        switch error.code {
        case .localSaveFailed: description = model.text("ローカルに保存できません。レポートを保持しています。", "Local save failed. The report is retained.")
        case .requestTimeout: description = model.text("応答がありません。レポートを保持しています。", "Request timed out. The report is retained.")
        case .networkError: description = model.text("接続できません。レポートを保持しています。", "Connection failed. The report is retained.")
        case .uploadRejected: description = model.text("Cloudが送信を拒否しました。設定や利用枠を確認してください。", "Cloud rejected the report. Check configuration and quota.")
        case .unexpectedResponse: description = model.text("受信結果を確認できません。", "The receipt could not be verified.")
        case .submissionCancelled: description = model.text("送信を中断しました。レポートを保持しています。", "Submission was interrupted. The report is retained.")
        default: description = model.text("レポートを作成できません。範囲とメモを確認してください。", "Could not prepare the report. Check the region and memo.")
        }
        return description + " (\(error.code.rawValue)" + (error.status.map { ", HTTP \($0)" } ?? "") + ")"
    }
}

private struct KueCropView: View {
    let image: UIImage
    @Binding var crop: KueCrop
    let locked: Bool
    let locale: KueLocale
    @State private var dragStart: KueCrop?
    var body: some View {
        GeometryReader { geometry in
            let factor = min(geometry.size.width / image.size.width, geometry.size.height / image.size.height)
            let size = CGSize(width: image.size.width * factor, height: image.size.height * factor)
            let rect = CGRect(x: crop.x * size.width, y: crop.y * size.height, width: crop.width * size.width, height: crop.height * size.height)
            ZStack {
                Image(uiImage: image).resizable().frame(width: size.width, height: size.height)
                Path { path in path.addRect(CGRect(origin: .zero, size: size)); path.addRect(rect) }
                    .fill(Color.black.opacity(0.48), style: FillStyle(eoFill: true)).allowsHitTesting(false)
                Rectangle().stroke(Color.orange, lineWidth: 2).background(Color.white.opacity(0.001))
                    .frame(width: rect.width, height: rect.height).position(x: rect.midX, y: rect.midY)
                    .gesture(DragGesture().onChanged { value in
                        guard !locked else { return }
                        let start = dragStart ?? crop; if dragStart == nil { dragStart = start }
                        crop = KueCrop(x: min(max(0, start.x + value.translation.width / size.width), 1 - start.width),
                            y: min(max(0, start.y + value.translation.height / size.height), 1 - start.height), width: start.width, height: start.height)
                    }.onEnded { _ in dragStart = nil })
                ForEach(0..<4) { corner in
                    let left = corner % 2 == 0; let top = corner < 2
                    Circle().fill(Color.orange).frame(width: 24, height: 24)
                        .position(x: left ? rect.minX : rect.maxX, y: top ? rect.minY : rect.maxY)
                        .gesture(DragGesture().onChanged { value in
                            guard !locked else { return }
                            let start = dragStart ?? crop; if dragStart == nil { dragStart = start }
                            let dx = value.translation.width / size.width; let dy = value.translation.height / size.height
                            let x1 = left ? min(max(0, start.x + dx), start.x + start.width - 0.12) : start.x
                            let y1 = top ? min(max(0, start.y + dy), start.y + start.height - 0.12) : start.y
                            let x2 = left ? start.x + start.width : max(min(1, start.x + start.width + dx), start.x + 0.12)
                            let y2 = top ? start.y + start.height : max(min(1, start.y + start.height + dy), start.y + 0.12)
                            crop = KueCrop(x: x1, y: y1, width: x2 - x1, height: y2 - y1)
                        }.onEnded { _ in dragStart = nil })
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(locale == .ja ? "範囲のサイズを変更 \(corner + 1)" : "Resize selection \(corner + 1)")
                        .accessibilityIdentifier("kue-crop-corner-\(corner)")
                        .accessibilityAddTraits(.isButton)
                }
            }.frame(width: size.width, height: size.height).position(x: geometry.size.width / 2, y: geometry.size.height / 2)
        }.background(Color(white: 0.92)).clipped()
    }
}
#endif
