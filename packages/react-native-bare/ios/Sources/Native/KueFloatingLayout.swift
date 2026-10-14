import Foundation
import CoreGraphics

/// Safe-area-local geometry matching the released Expo trigger menu.
struct KueMenuLayout {
    let origin: CGPoint
    let items: [CGPoint]
    let labels: [CGRect]

    func offsetBy(dx: CGFloat, dy: CGFloat) -> KueMenuLayout {
        KueMenuLayout(origin: CGPoint(x: origin.x + dx, y: origin.y + dy),
                      items: items.map { CGPoint(x: $0.x + dx, y: $0.y + dy) },
                      labels: labels.map { $0.offsetBy(dx: dx, dy: dy) })
    }
}

enum KueFloatingLayout {
    private enum Side { case left, right, above, below }
    static func labelWidth(_ name: String) -> CGFloat {
        ceil(name.unicodeScalars.reduce(26.0) { $0 + ((0x20...0x24f).contains($1.value) ? 8.6 : 14.6) })
    }
    private static func around(_ point: CGPoint, _ half: CGFloat) -> CGRect {
        CGRect(x: point.x - half, y: point.y - half, width: half * 2, height: half * 2)
    }
    private static func inside(_ rect: CGRect, _ bounds: CGSize) -> Bool {
        rect.minX >= 8 && rect.minY >= 8 && rect.maxX <= bounds.width - 8 && rect.maxY <= bounds.height - 8
    }
    private static func overlaps(_ lhs: CGRect, _ rhs: CGRect, _ gap: CGFloat) -> Bool {
        lhs.minX < rhs.maxX + gap && lhs.maxX + gap > rhs.minX && lhs.minY < rhs.maxY + gap && lhs.maxY + gap > rhs.minY
    }
    private static func placeLabels(origin: CGPoint, items: [CGPoint], estimates: [CGFloat], bounds: CGSize,
                                    sides: [Side]) -> [CGRect]? {
        let targets = [around(origin, 27)] + items.map { around($0, 22) }
        var labels: [CGRect] = []
        for (index, point) in items.enumerated() {
            let estimate = estimates[index], need = min(estimate, 120)
            var fitted: CGRect?
            for side in sides {
                let room: CGFloat
                switch side { case .left: room = point.x - 30 - 8
                case .right: room = bounds.width - 8 - point.x - 30
                default: room = bounds.width - 16 }
                let width = min(estimate, floor(bounds.width * 0.6), floor(room))
                guard width >= need else { continue }
                let rect: CGRect
                switch side {
                case .left: rect = CGRect(x: point.x - 30 - width, y: point.y - 15, width: width, height: 30)
                case .right: rect = CGRect(x: point.x + 30, y: point.y - 15, width: width, height: 30)
                case .above, .below:
                    rect = CGRect(x: max(8, min(point.x - width / 2, bounds.width - 8 - width)),
                                  y: side == .above ? point.y - 60 : point.y + 30, width: width, height: 30)
                }
                if inside(rect, bounds) && !targets.contains(where: { overlaps(rect, $0, 2) }) &&
                    !labels.contains(where: { overlaps(rect, $0, 4) }) { fitted = rect; break }
            }
            guard let fitted else { return nil }; labels.append(fitted)
        }
        return labels
    }
    static func menu(origin: CGPoint, bounds: CGSize, names: [String]) -> KueMenuLayout? {
        let count = names.count
        guard (1...5).contains(count), bounds.width >= 160, bounds.height >= 160 else { return nil }
        let estimates = names.map(labelWidth)
        let roomier: Side = origin.x > bounds.width / 2 ? .left : .right
        let other: Side = roomier == .left ? .right : .left
        func fits(_ points: [CGPoint]) -> Bool { points.allSatisfy { inside(around($0, 22), bounds) } }
        let columnX = max(30, min(origin.x, bounds.width - 30))
        for direction: CGFloat in origin.y > bounds.height / 2 ? [-1, 1] : [1, -1] {
            let items = (0..<count).map { CGPoint(x: columnX, y: origin.y + direction * (64 + CGFloat($0) * 56)) }
            if fits(items), let labels = placeLabels(origin: origin, items: items, estimates: estimates, bounds: bounds, sides: [roomier]) {
                return KueMenuLayout(origin: origin, items: items, labels: labels)
            }
        }
        let dx = bounds.width / 2 - origin.x, dy = bounds.height / 2 - origin.y
        let preferred = hypot(dx, dy) < 40 ? -.pi / 2 : atan2(dy, dx)
        for tidy in [true, false] { for radius: CGFloat in [72, 82, 94, 108] {
            let step = count < 2 ? 0 : 2 * asin(28 / radius)
            for turn in 0...90 { for sign: CGFloat in turn == 0 ? [1] : [1, -1] {
                let heading = preferred + sign * CGFloat(turn) * .pi / 90
                let items = (0..<count).map { index -> CGPoint in
                    let angle = heading + step * (CGFloat(index) - CGFloat(count - 1) / 2)
                    return CGPoint(x: origin.x + cos(angle) * radius, y: origin.y + sin(angle) * radius)
                }
                guard fits(items) else { continue }
                let outward: Side = cos(heading) < -0.3 ? .left : cos(heading) > 0.3 ? .right : roomier
                let sides: [Side] = tidy ? [outward] : [outward, .above, outward == roomier ? other : roomier, .below]
                if let labels = placeLabels(origin: origin, items: items, estimates: estimates, bounds: bounds, sides: sides) {
                    return KueMenuLayout(origin: origin, items: items, labels: labels)
                }
            } }
        } }
        return nil
    }
    static func selection(_ layout: KueMenuLayout, pointer: CGPoint) -> Int? {
        guard hypot(pointer.x - layout.origin.x, pointer.y - layout.origin.y) >= 38 else { return nil }
        if let index = layout.items.firstIndex(where: { hypot(pointer.x - $0.x, pointer.y - $0.y) <= 22 }) { return index }
        if let index = layout.labels.firstIndex(where: { pointer.x >= $0.minX && pointer.x <= $0.maxX && pointer.y >= $0.minY && pointer.y <= $0.maxY }) { return index }
        var selected: Int?, distance: CGFloat = 30
        for (index, item) in layout.items.enumerated() {
            let next = hypot(pointer.x - item.x, pointer.y - item.y)
            if next < distance { distance = next; selected = index }
        }
        return selected
    }
}
