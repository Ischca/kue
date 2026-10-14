import Foundation

enum KueRNInputs {
    static func finding(_ object: [String: Any], media: KueRNMedia) throws -> KueFinding {
        let identifier = try KueRNWire.string(object, "clientReportId")
        let memo = try KueRNWire.string(object, "memo")
        let overrides = try KueRNWire.context(KueRNWire.optionalObject(object, "context"), allowPlatform: true)
        let rawContext = try KueRNWire.optionalObject(object, "context") ?? [:]
        let platform = try KueRNWire.string(rawContext, "platform")
        guard ["ios", "android"].contains(platform) else { throw KueRNFailure("invalid_report") }
        let context = KueReportContext(platform: platform, osVersion: overrides.osVersion, deviceModel: overrides.deviceModel,
            appVersion: overrides.appVersion, buildNumber: overrides.buildNumber, screenWidth: overrides.screenWidth,
            screenHeight: overrides.screenHeight, route: overrides.route)
        let captured = try KueRNWire.date(KueRNWire.string(object, "capturedAt"))
        if object["video"] != nil {
            guard object["screenshot"] == nil, object["crop"] == nil, object["sourceSize"] == nil else { throw KueRNFailure("invalid_report") }
            let video = try KueRNWire.object(object, "video")
            guard try KueRNWire.string(video, "mimeType") == "video/mp4" else { throw KueRNFailure("invalid_report") }
            let bytes = try media.read(KueRNWire.string(video, "uri"), maximum: 20 * 1024 * 1024)
            guard bytes.count == (try KueRNWire.integer(video, "byteSize", maximum: 20 * 1024 * 1024)) else { throw KueRNFailure("invalid_report") }
            return .video(try KueVideoReport(clientReportId: identifier, memo: memo, videoData: bytes,
                durationMs: KueRNWire.integer(video, "durationMs", maximum: 60_000), outputSize: size(video), context: context, capturedAt: captured))
        }
        let image = try KueRNWire.object(object, "screenshot"), crop = try KueRNWire.object(object, "crop")
        let output = try size(image), source = try size(KueRNWire.object(object, "sourceSize"))
        let mime = try KueRNWire.string(image, "mimeType")
        let data = try media.image(KueRNWire.string(image, "uri"), width: output.width, height: output.height, mimeType: mime)
        return .screenshot(try KueReport(clientReportId: identifier, memo: memo,
            crop: KueCrop(x: KueRNWire.number(crop, "x"), y: KueRNWire.number(crop, "y"), width: KueRNWire.number(crop, "width"), height: KueRNWire.number(crop, "height")),
            imageData: data, mimeType: mime, sourceSize: source, outputSize: output, context: context, capturedAt: captured))
    }
    static func size(_ value: [String: Any]) throws -> KueImageSize {
        try KueImageSize(width: KueRNWire.integer(value, "width", maximum: 100_000), height: KueRNWire.integer(value, "height", maximum: 100_000))
    }
    static func group(_ value: [String: Any], media: KueRNMedia) throws -> KueReportGroup {
        guard let list = value["findings"] as? [[String: Any]], (1...10).contains(list.count) else { throw KueRNFailure("invalid_report") }
        // Snapshot each bounded file, then enforce the aggregate group admission limit.
        var findings: [KueFinding] = [], total = 0
        for object in list {
            let item = try finding(object, media: media)
            guard item.mediaData.count <= 20 * 1024 * 1024 - total else { throw KueRNFailure("invalid_report") }
            total += item.mediaData.count; findings.append(item)
        }
        return try KueReportGroup(clientReportId: KueRNWire.string(value, "clientReportId"), title: KueRNWire.string(value, "title"), findings: findings)
    }
}
