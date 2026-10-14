#if canImport(UIKit)
import UIKit
import SwiftUI

/// Native accessory remains reachable with Japanese IME and presented hosting controllers.
@MainActor struct KueMemoInput: UIViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool
    var disabled = false
    let locale: KueLocale
    let identifier: String
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 8, left: 4, bottom: 8, right: 4)
        view.delegate = context.coordinator; view.accessibilityIdentifier = identifier
        context.coordinator.view = view
        let toolbar = UIToolbar(frame: CGRect(x: 0, y: 0, width: UIScreen.main.bounds.width, height: 44))
        toolbar.autoresizingMask = [.flexibleWidth]
        let done = UIButton(type: .system)
        done.setTitle(locale == .ja ? "完了" : "Done", for: .normal)
        done.titleLabel?.font = .preferredFont(forTextStyle: .body)
        done.titleLabel?.adjustsFontForContentSizeCategory = true
        done.frame = CGRect(x: 0, y: 0, width: max(64, done.intrinsicContentSize.width + 24), height: 44)
        done.addTarget(context.coordinator, action: #selector(Coordinator.done), for: .touchUpInside)
        done.isAccessibilityElement = true
        done.accessibilityIdentifier = "kue-keyboard-done"
        context.coordinator.doneButton = done
        toolbar.items = [UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil), UIBarButtonItem(customView: done)]
        view.inputAccessoryView = toolbar
        context.coordinator.observeKeyboard()
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        // The native editor owns text/selection while typing. SwiftUI can deliver an
        // older binding snapshot between IME/delegate updates; applying it here
        // would reset the cursor and replace an in-progress composition.
        if !view.isFirstResponder && view.markedTextRange == nil && view.text != text {
            let selection = view.selectedRange
            view.text = text
            let length = (text as NSString).length
            let location = min(selection.location, length)
            view.selectedRange = NSRange(location: location, length: min(selection.length, length - location))
        }
        if !view.isFirstResponder || !disabled { view.isEditable = !disabled }
        context.coordinator.doneButton?.setTitle(locale == .ja ? "完了" : "Done", for: .normal)
        if view.isFirstResponder && (!focused || disabled) { context.coordinator.finishEditingLater() }
        context.coordinator.keepVisible()
    }
    static func dismantleUIView(_ view: UITextView, coordinator: Coordinator) { coordinator.restoreScrollInsets(); coordinator.removeObservers() }
    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var parent: KueMemoInput
        weak var view: UITextView?
        weak var doneButton: UIButton?
        weak var scroll: UIScrollView?
        private var originalInsets: (content: UIEdgeInsets, indicators: UIEdgeInsets)?
        private var keyboardFrame: CGRect?
        private var observers: [NSObjectProtocol] = []
        private var finishTask: Task<Void, Never>?
        init(_ parent: KueMemoInput) { self.parent = parent }
        func textViewDidBeginEditing(_ textView: UITextView) { parent.focused = true; findScroll(); keepVisible() }
        func textViewDidEndEditing(_ textView: UITextView) { commit(textView); if parent.focused { parent.focused = false }; restoreScrollInsets() }
        func textViewDidChange(_ textView: UITextView) { commit(textView); keepVisible() }
        private func commit(_ textView: UITextView) { if parent.text != textView.text { parent.text = textView.text } }
        func finishEditingLater() {
            guard finishTask == nil else { return }
            finishTask = Task { @MainActor [weak self] in
                guard let self, !Task.isCancelled else { return }
                self.finishTask = nil
                guard self.view?.isFirstResponder == true, !self.parent.focused || self.parent.disabled else { return }
                self.done()
                self.view?.isEditable = !self.parent.disabled
            }
        }
        func observeKeyboard() {
            for name in [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardDidChangeFrameNotification, UIResponder.keyboardDidShowNotification, UIResponder.keyboardDidHideNotification] {
                observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                    let frame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
                    let hidden = notification.name == UIResponder.keyboardDidHideNotification
                    Task { @MainActor in
                        guard let self else { return }
                        self.keyboardFrame = hidden ? nil : frame
                        if hidden { self.restoreScrollInsets() }
                        else { self.keepVisible() }
                    }
                })
            }
        }
        private func findScroll() {
            guard scroll == nil else { return }
            var ancestor = view?.superview
            while let candidate = ancestor {
                if let found = candidate as? UIScrollView {
                    scroll = found; originalInsets = (found.contentInset, found.verticalScrollIndicatorInsets); return
                }
                ancestor = candidate.superview
            }
        }
        func keepVisible() {
            guard let view, view.isFirstResponder, let window = view.window, let frame = keyboardFrame else { return }
            let keyboard = window.convert(frame, from: window.screen.coordinateSpace).intersection(window.bounds)
            guard !keyboard.isNull, keyboard.height > 0 else { restoreScrollInsets(); return }
            findScroll(); guard let scroll, let originalInsets else { return }
            var top = keyboard.minY
            if let accessory = view.inputAccessoryView, accessory.window != nil {
                let bar = accessory.convert(accessory.bounds, to: window)
                if bar.intersects(window.bounds), bar.height > 0 { top = min(top, bar.minY) }
            }
            // SwiftUI's viewport may or may not already shrink for third-party keyboards.
            // Add enough scrollable space for the actual remaining obstruction in either case.
            let viewport = scroll.convert(scroll.bounds, to: window)
            let obstruction = max(0, viewport.maxY - top) + 16
            var inset = originalInsets.content; inset.bottom += obstruction; scroll.contentInset = inset
            var indicators = originalInsets.indicators; indicators.bottom += obstruction; scroll.verticalScrollIndicatorInsets = indicators
            scroll.layoutIfNeeded()
            let field = view.convert(view.bounds, to: window)
            let shift = max(0, field.maxY - (top - 16))
            guard shift > 0 else { return }
            let maximum = max(-scroll.adjustedContentInset.top, scroll.contentSize.height + scroll.adjustedContentInset.bottom - scroll.bounds.height)
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: min(maximum, scroll.contentOffset.y + shift)), animated: false)
        }
        func restoreScrollInsets() {
            if let scroll, let originalInsets { scroll.contentInset = originalInsets.content; scroll.verticalScrollIndicatorInsets = originalInsets.indicators }
            scroll = nil; originalInsets = nil
        }
        func removeObservers() { finishTask?.cancel(); finishTask = nil; observers.forEach { NotificationCenter.default.removeObserver($0) }; observers = [] }
        deinit { finishTask?.cancel(); observers.forEach { NotificationCenter.default.removeObserver($0) } }
        @objc func done() {
            guard let view else { return }
            view.unmarkText(); commit(view)
            view.resignFirstResponder(); if parent.focused { parent.focused = false }
        }
    }
}
#endif
