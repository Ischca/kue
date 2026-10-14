import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

enum KueLocale { ja, en }

enum KueButtonDesign { classic, mascot }

enum KueReportOutcome {
  submitted,
  cancelled,
  disabled,
  busy,
  queued,
  findingAdded,
}

enum KueReceiptStatus { received, queued }

enum KueRecordingMode { auto, off }

enum KueRecordingAvailability {
  off,
  cloudRequired,
  checking,
  checkFailed,
  upgrade,
  unavailable,
  rebuild,
  ready;

  static KueRecordingAvailability fromWire(String value) => switch (value) {
    'off' => off,
    'cloud_required' => cloudRequired,
    'checking' => checking,
    'check_failed' => checkFailed,
    'upgrade' => upgrade,
    'unavailable' => unavailable,
    'rebuild' => rebuild,
    'ready' => ready,
    _ => throw const FormatException('Invalid recording availability.'),
  };
}

/// Rectangle in the original capture, normalized to 0..1.
class KueCrop {
  const KueCrop({this.x = 0, this.y = 0, this.width = 1, this.height = 1});
  final double x;
  final double y;
  final double width;
  final double height;
  factory KueCrop.fromJson(Map map) => KueCrop(
    x: (map['x'] as num).toDouble(),
    y: (map['y'] as num).toDouble(),
    width: (map['width'] as num).toDouble(),
    height: (map['height'] as num).toDouble(),
  );
  Map<String, double> toJson() => {
    'x': x,
    'y': y,
    'width': width,
    'height': height,
  };
  bool get isValid =>
      [x, y, width, height].every((v) => v.isFinite) &&
      x >= 0 &&
      y >= 0 &&
      width > 0 &&
      height > 0 &&
      x + width <= 1 &&
      y + height <= 1;
}

class KueImageSize {
  const KueImageSize(this.width, this.height);
  final int width;
  final int height;
  factory KueImageSize.fromJson(Map map) => KueImageSize(
    (map['width'] as num).toInt(),
    (map['height'] as num).toInt(),
  );
  Map<String, int> toJson() => {'width': width, 'height': height};
}

/// Overrides merge over automatic native application/display metadata.
class KueContextOverrides {
  const KueContextOverrides({
    this.osVersion,
    this.deviceModel,
    this.appVersion,
    this.buildNumber,
    this.screenWidth,
    this.screenHeight,
    this.route,
  });
  final String? osVersion;
  final String? deviceModel;
  final String? appVersion;
  final String? buildNumber;
  final double? screenWidth;
  final double? screenHeight;
  final String? route;
  Map<String, Object> toJson() => {
    if (osVersion != null) 'osVersion': osVersion!,
    if (deviceModel != null) 'deviceModel': deviceModel!,
    if (appVersion != null) 'appVersion': appVersion!,
    if (buildNumber != null) 'buildNumber': buildNumber!,
    if (screenWidth != null) 'screenWidth': screenWidth!,
    if (screenHeight != null) 'screenHeight': screenHeight!,
    if (route != null) 'route': route!,
  };
}

class KueContext extends KueContextOverrides {
  const KueContext({
    required this.platform,
    super.osVersion,
    super.deviceModel,
    super.appVersion,
    super.buildNumber,
    super.screenWidth,
    super.screenHeight,
    super.route,
  });
  final String platform;
  factory KueContext.fromJson(Map map) => KueContext(
    platform: map['platform'] as String,
    osVersion: map['osVersion'] as String?,
    deviceModel: map['deviceModel'] as String?,
    appVersion: map['appVersion'] as String?,
    buildNumber: map['buildNumber'] as String?,
    route: map['route'] as String?,
    screenWidth: (map['screenWidth'] as num?)?.toDouble(),
    screenHeight: (map['screenHeight'] as num?)?.toDouble(),
  );
  @override
  Map<String, Object> toJson() => {'platform': platform, ...super.toJson()};
}

abstract class KueFinding {
  KueFinding();
  String get clientReportId;
  String get memo;
  Uint8List get mediaBytes;
  KueImageSize get outputSize;
  KueContext get context;
  DateTime get capturedAt;
  String get mimeType;
  Map<String, Object> get metadata;
  int get byteSize => mediaBytes.length;
  bool get isVideo => mimeType == 'video/mp4';

  factory KueFinding.fromNative(Map map) {
    final raw = map['metadataJson'];
    final metadata = raw is String
        ? jsonDecode(raw) as Map
        : map['metadata'] as Map;
    final capture = metadata['capture'] as Map;
    final bytes = map['mediaBytes'] as Uint8List;
    final context = KueContext.fromJson(metadata['context'] as Map);
    final at = DateTime.parse(capture['capturedAt'] as String);
    final size = KueImageSize.fromJson(capture['outputSize'] as Map);
    if (capture['kind'] == 'video') {
      return KueVideoFinding(
        clientReportId: map['clientReportId'] as String,
        memo: map['memo'] as String,
        videoBytes: bytes,
        outputSize: size,
        context: context,
        capturedAt: at,
        durationMs: capture['durationMs'] as int,
      );
    }
    return KueLocalReport(
      clientReportId: map['clientReportId'] as String,
      memo: map['memo'] as String,
      imageBytes: bytes,
      mimeType: capture['mimeType'] as String,
      crop: KueCrop.fromJson(capture['crop'] as Map),
      sourceSize: KueImageSize.fromJson(capture['sourceSize'] as Map),
      outputSize: size,
      context: context,
      capturedAt: at,
    );
  }
}

/// Immutable image payload. Copy/upload inside onSubmit when persistence is needed.
class KueLocalReport extends KueFinding {
  KueLocalReport({
    String? clientReportId,
    required String memo,
    Uint8List? pngBytes,
    Uint8List? imageBytes,
    this.mimeType = 'image/png',
    required this.crop,
    required this.sourceSize,
    required this.outputSize,
    required this.context,
    required DateTime capturedAt,
  }) : clientReportId = clientReportId ?? newKueReportId(),
       memo = memo.trim(),
       imageBytes = Uint8List.fromList(
         _imageInput(pngBytes, imageBytes),
       ).asUnmodifiableView(),
       capturedAt = capturedAt.toUtc();
  factory KueLocalReport.fromNative(Map map) {
    final finding = KueFinding.fromNative(map);
    if (finding is! KueLocalReport) {
      throw const FormatException('Expected screenshot.');
    }
    return finding;
  }
  @override
  final String clientReportId;
  @override
  final String memo;
  final Uint8List imageBytes;

  /// Compatibility alias. New native Android reports can contain JPEG bytes.
  Uint8List get pngBytes => imageBytes;
  @override
  Uint8List get mediaBytes => imageBytes;
  final KueCrop crop;
  final KueImageSize sourceSize;
  @override
  final KueImageSize outputSize;
  @override
  final KueContext context;
  @override
  final DateTime capturedAt;
  @override
  final String mimeType;
  @override
  Map<String, Object> get metadata => {
    'schemaVersion': 1,
    'context': context.toJson(),
    'capture': {
      'capturedAt': capturedAt.toIso8601String(),
      'crop': crop.toJson(),
      'sourceSize': sourceSize.toJson(),
      'outputSize': outputSize.toJson(),
      'mimeType': mimeType,
    },
  };
}

Uint8List _imageInput(Uint8List? png, Uint8List? image) {
  if ((png == null) == (image == null)) {
    throw ArgumentError('Supply one image byte array.');
  }
  return image ?? png!;
}

class KueVideoFinding extends KueFinding {
  KueVideoFinding({
    String? clientReportId,
    required String memo,
    required Uint8List videoBytes,
    required this.outputSize,
    required this.context,
    required DateTime capturedAt,
    required this.durationMs,
  }) : clientReportId = clientReportId ?? newKueReportId(),
       memo = memo.trim(),
       videoBytes = Uint8List.fromList(videoBytes).asUnmodifiableView(),
       capturedAt = capturedAt.toUtc();
  @override
  final String clientReportId;
  @override
  final String memo;
  final Uint8List videoBytes;
  final int durationMs;
  @override
  Uint8List get mediaBytes => videoBytes;
  @override
  final KueImageSize outputSize;
  @override
  final KueContext context;
  @override
  final DateTime capturedAt;
  @override
  String get mimeType => 'video/mp4';
  @override
  Map<String, Object> get metadata => {
    'schemaVersion': 2,
    'context': context.toJson(),
    'capture': {
      'capturedAt': capturedAt.toIso8601String(),
      'kind': 'video',
      'durationMs': durationMs,
      'outputSize': outputSize.toJson(),
      'mimeType': mimeType,
    },
  };
}

class KueReportGroup {
  KueReportGroup({
    String? clientReportId,
    required String title,
    required List<KueFinding> findings,
  }) : clientReportId = clientReportId ?? newKueReportId(),
       title = title.trim(),
       findings = List.unmodifiable(findings);
  final String clientReportId;
  final String title;
  final List<KueFinding> findings;
  int get byteSize =>
      findings.fold(0, (all, finding) => all + finding.byteSize);
  Map<String, Object> get manifest => {
    'schemaVersion': 1,
    'title': title,
    'findings': findings
        .map((f) => {'memo': f.memo, 'metadata': f.metadata})
        .toList(),
  };
  factory KueReportGroup.fromNative(Map map) => KueReportGroup(
    clientReportId: map['clientReportId'] as String,
    title: map['title'] as String,
    findings: (map['findings'] as List)
        .map((f) => KueFinding.fromNative(f as Map))
        .toList(),
  );
}

String newKueReportId() {
  final random = Random.secure();
  return 'flutter_${base64Url.encode(List<int>.generate(24, (_) => random.nextInt(256))).replaceAll('=', '')}';
}

class KueReceipt {
  const KueReceipt({
    required this.clientReportId,
    required this.id,
    required this.status,
    this.receiptToken,
  });
  final String clientReportId;
  final String id;
  final KueReceiptStatus status;

  /// Secret read capability. Never log or display it in an Issue.
  final String? receiptToken;
  factory KueReceipt.fromNative(Map map) {
    final status = map['status'];
    if (status != 'received' && status != 'queued') {
      throw const FormatException('Invalid receipt.');
    }
    return KueReceipt(
      clientReportId: map['clientReportId'] as String,
      id: map['id'] as String,
      status: status == 'received'
          ? KueReceiptStatus.received
          : KueReceiptStatus.queued,
      receiptToken: map['receiptToken'] as String?,
    );
  }
}

class KueProjectFeatures {
  const KueProjectFeatures({
    required this.groups,
    required this.recordingEntitled,
    required this.recordingAvailable,
  });
  final bool groups, recordingEntitled, recordingAvailable;
  factory KueProjectFeatures.fromJson(Map map) {
    final recording = map['recording'];
    if (map['schemaVersion'] != 1 ||
        map['groups'] is! bool ||
        recording is! Map ||
        recording['entitled'] is! bool ||
        recording['available'] is! bool) {
      throw const FormatException('Invalid project features.');
    }
    return KueProjectFeatures(
      groups: map['groups'] as bool,
      recordingEntitled: recording['entitled'] as bool,
      recordingAvailable: recording['available'] as bool,
    );
  }
}

enum KueReportDeliveryStatus {
  received,
  queued,
  creatingIssue,
  completed,
  failed,
}

class KueGitHubIssue {
  const KueGitHubIssue({required this.number, required this.url});
  final int number;
  final String url;
}

class KueReportStatus {
  const KueReportStatus({
    required this.id,
    required this.status,
    this.githubIssue,
    this.errorCode,
  });
  final String id;
  final KueReportDeliveryStatus status;
  final KueGitHubIssue? githubIssue;
  final String? errorCode;
  factory KueReportStatus.fromJson(Map map, {String? expectedId}) {
    final id = map['id'];
    const states = {
      'received': KueReportDeliveryStatus.received,
      'queued': KueReportDeliveryStatus.queued,
      'creating_issue': KueReportDeliveryStatus.creatingIssue,
      'completed': KueReportDeliveryStatus.completed,
      'failed': KueReportDeliveryStatus.failed,
    };
    final state = states[map['status']];
    if (id is! String ||
        !RegExp(r'^report_[A-Za-z0-9_-]+$').hasMatch(id) ||
        (expectedId != null && expectedId != id) ||
        state == null ||
        !map.containsKey('githubIssue')) {
      throw const FormatException('Invalid report status.');
    }
    KueGitHubIssue? issue;
    final raw = map['githubIssue'];
    if (raw != null) {
      if (raw is! Map ||
          raw['number'] is! int ||
          (raw['number'] as int) <= 0 ||
          (raw['number'] as int) > 9007199254740991 ||
          raw['url'] is! String ||
          !RegExp(
            r'^https://github\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+/issues/\d+$',
          ).hasMatch(raw['url'] as String)) {
        throw const FormatException('Invalid Issue link.');
      }
      issue = KueGitHubIssue(
        number: raw['number'] as int,
        url: raw['url'] as String,
      );
    }
    String? error;
    if (map.containsKey('error')) {
      final value = map['error'];
      if (value is! Map || value['code'] is! String) {
        throw const FormatException('Invalid delivery error.');
      }
      error = value['code'] as String;
    } else if (map['errorCode'] is String) {
      error = map['errorCode'] as String;
    }
    return KueReportStatus(
      id: id,
      status: state,
      githubIssue: issue,
      errorCode: error,
    );
  }
}

enum KuePendingState { pending, blocked }

class KuePendingReport {
  const KuePendingReport({
    required this.clientReportId,
    required this.savedAt,
    required this.nextAttemptAt,
    required this.state,
    required this.currentDestination,
    this.attempts,
  });
  final String clientReportId;
  final DateTime savedAt, nextAttemptAt;
  final KuePendingState state;
  final bool currentDestination;
  final int? attempts;
  factory KuePendingReport.fromNative(Map map) {
    DateTime date(Object? value) => value is int
        ? DateTime.fromMillisecondsSinceEpoch(value, isUtc: true)
        : DateTime.parse(value as String).toUtc();
    final state = map['state'];
    if (state != 'pending' && state != 'blocked') {
      throw const FormatException('Invalid outbox state.');
    }
    return KuePendingReport(
      clientReportId: map['clientReportId'] as String,
      savedAt: date(map['savedAt']),
      nextAttemptAt: date(map['nextAttemptAt']),
      state: state == 'pending'
          ? KuePendingState.pending
          : KuePendingState.blocked,
      currentDestination: map['currentDestination'] as bool,
      attempts: map['attempts'] as int?,
    );
  }
}

class KueCloudError implements Exception {
  const KueCloudError(
    this.message, {
    required this.code,
    this.retryable = false,
    this.status,
    this.serverCode,
    this.retryAfter,
  });
  final String message;
  final String code;
  final bool retryable;
  final int? status;
  final String? serverCode;
  final Duration? retryAfter;
  @override
  String toString() => '$code: $message';
}

/// Cancels a Cloud request when the editor or host closes.
class KueCancellationToken {
  bool _cancelled = false;
  final List<void Function()> _listeners = [];
  bool get isCancelled => _cancelled;
  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    final listeners = List.of(_listeners);
    _listeners.clear();
    for (final listener in listeners) {
      try {
        listener();
      } catch (_) {
        /* Continue all teardown. */
      }
    }
  }

  void addListener(void Function() listener) {
    if (_cancelled) {
      listener();
    } else {
      _listeners.add(listener);
    }
  }

  void removeListener(void Function() listener) => _listeners.remove(listener);
}
