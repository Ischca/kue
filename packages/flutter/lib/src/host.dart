import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'cloud.dart';
import 'models.dart';
import 'platform.dart';

typedef KueSubmitHandler = FutureOr<void> Function(KueLocalReport report);
typedef KueSubmitGroupHandler = FutureOr<void> Function(KueReportGroup group);
typedef KueCaptureAdapter = Future<KueCapturedImage> Function();
typedef KueTriggerCleanup = FutureOr<void> Function();
typedef KueTriggerSource =
    FutureOr<KueTriggerCleanup> Function(void Function() open);

// Native delays must also fit Duration's signed 64-bit microseconds.
const _maxNativeRetryAfterMs = 9007199254740991;

void _notify(void Function(Object)? callback, Object error) {
  try {
    callback?.call(error);
  } catch (_) {
    /* Observers never change acceptance. */
  }
}

class KueCapturedImage {
  KueCapturedImage({required Uint8List pngBytes, required this.capturedAt})
    : pngBytes = Uint8List.fromList(pngBytes).asUnmodifiableView();
  final Uint8List pngBytes;
  final DateTime capturedAt;
}

/// One controller attaches to one host. Native code owns the report UI/session.
class KueController {
  _KueHostState? _host;
  final state = ValueNotifier<KueRuntimeState>(const KueRuntimeState());
  Future<KueReportOutcome> reportIssue({
    String memo = '',
    KueContextOverrides? context,
  }) =>
      _host?._reportIssue(memo, context) ??
      Future.value(KueReportOutcome.disabled);
  Future<void> openSavedFindings() => _command('openSavedFindings');
  Future<void> openOutbox() => _command('openOutbox');
  Future<void> beginRecording() => _command('beginRecording');
  Future<void> stopRecording() => _command('stopRecording');
  Future<KueProjectFeatures> features() async => KueProjectFeatures.fromJson(
    kueNativeMap(await _requireHost()._invoke('features')),
  );
  Future<KueReportStatus> status(KueReceipt receipt) async =>
      KueReportStatus.fromJson(
        kueNativeMap(
          await _requireHost()._invoke('status', {
            'receipt': {
              'clientReportId': receipt.clientReportId,
              'id': receipt.id,
              'status': receipt.status.name,
              if (receipt.receiptToken != null)
                'receiptToken': receipt.receiptToken,
            },
          }),
        ),
        expectedId: receipt.id,
      );
  Future<List<KuePendingReport>> pendingReports({
    bool includeOtherDestinations = false,
  }) async {
    final value = await _requireHost()._invoke('pendingReports', {
      'includeOtherDestinations': includeOtherDestinations,
    });
    if (value is! List) {
      throw const KueCloudError(
        'Invalid native response.',
        code: 'unexpected_response',
      );
    }
    return List.unmodifiable(
      value.map((entry) => KuePendingReport.fromNative(kueNativeMap(entry))),
    );
  }

  Future<void> retryPendingReports({bool force = false}) =>
      _command('retryPendingReports', {'force': force});
  Future<void> discardPendingReport(
    String clientReportId, {
    bool includeOtherDestinations = false,
  }) => _command('discardPendingReport', {
    'clientReportId': clientReportId,
    'includeOtherDestinations': includeOtherDestinations,
  });
  _KueHostState _requireHost() =>
      _host ?? (throw StateError('KUE requires a mounted native host.'));
  Future<void> _command(
    String method, [
    Map<String, Object?> arguments = const {},
  ]) async {
    await _requireHost()._invoke(method, arguments);
  }
}

/// Flutter capture plus the required native controller. No Dart report UI.
class KueHost extends StatefulWidget {
  const KueHost({
    super.key,
    required this.controller,
    required this.child,
    this.onSubmit,
    this.onSubmitGroup,
    this.submitLabel,
    this.groupSubmitLabel,
    this.cloud,
    this.onReceipt,
    this.onQueued,
    this.onError,
    this.onState,
    this.context,
    this.capture,
    this.enabled = kDebugMode,
    this.floatingButton = true,
    this.buttonDesign = KueButtonDesign.classic,
    this.locale,
    this.recording = KueRecordingMode.auto,
    this.offlineQueue = false,
    this.shakeTrigger = false,
    this.systemScreenshotTrigger = false,
    this.triggers = const [],
    this.callbackTimeout = const Duration(seconds: 30),
    this.platform,
  });
  final KueController controller;
  final Widget child;
  final KueSubmitHandler? onSubmit;
  final KueSubmitGroupHandler? onSubmitGroup;
  final String? submitLabel, groupSubmitLabel;
  final KueCloudConfig? cloud;
  final void Function(KueReceipt)? onReceipt;
  final void Function(String)? onQueued;
  final void Function(Object)? onError;
  final void Function(KueRuntimeState)? onState;
  final KueContextOverrides? context;
  final KueCaptureAdapter? capture;
  final bool enabled,
      floatingButton,
      offlineQueue,
      shakeTrigger,
      systemScreenshotTrigger;
  final KueButtonDesign buttonDesign;
  final KueLocale? locale;
  final KueRecordingMode recording;
  final List<KueTriggerSource> triggers;
  final Duration callbackTimeout;

  /// Override only for tests or a compatible native integration.
  final KuePlatform? platform;
  @override
  State<KueHost> createState() => _KueHostState();
}

class _KueHostState extends State<KueHost> with WidgetsBindingObserver {
  final _captureKey = GlobalKey();
  final _sessionId = newKueReportId(),
      _handlerId = newKueReportId(),
      _groupHandlerId = newKueReportId();
  final _operations = <String, Completer<KueReportOutcome>>{};
  final _subscriptions = <String, _TriggerSubscription>{};
  late final KuePlatform _platform;
  late final KueController _controller;
  late final bool _requiresNativeAnchor;
  late final Future<void> _ready;
  late final List<String> _triggerIds;
  late final KueSubmitHandler? _onSubmit;
  late final KueSubmitGroupHandler? _onSubmitGroup;
  late final KueCaptureAdapter? _captureAdapter;
  late final KueCloudConfig? _cloud;
  late bool _enabled;
  late final bool _offlineQueue;
  late KueRecordingMode _recording;
  late final Duration _callbackTimeout;
  late final List<KueTriggerSource> _triggers;
  bool _alive = true, _foreground = true, _capturing = false;
  String? _captureOperationId;
  bool _captureCancelled = false;
  KueLocale? _attachedLocale;

  void _validate() {
    if (widget.cloud == null && widget.onSubmit == null) {
      throw ArgumentError(
        'KueHost requires cloud or an explicit local onSubmit.',
      );
    }
    if ((widget.onSubmit != null &&
            (widget.submitLabel?.trim().isEmpty ?? true)) ||
        (widget.onSubmitGroup != null &&
            ((widget.groupSubmitLabel ?? widget.submitLabel)?.trim().isEmpty ??
                true))) {
      throw ArgumentError(
        'Each local submission handler requires a nonempty label.',
      );
    }
    if (widget.callbackTimeout.inMilliseconds < 1 ||
        widget.callbackTimeout.inMicroseconds % 1000 != 0 ||
        widget.callbackTimeout > const Duration(minutes: 2)) {
      throw ArgumentError(
        'callbackTimeout must be greater than zero and at most two minutes.',
      );
    }
    if (_controller._host != null && _controller._host != this) {
      throw StateError('A KueController attaches to only one mounted KueHost.');
    }
    widget.cloud?.endpoint();
  }

  @override
  void initState() {
    super.initState();
    _controller = widget.controller;
    _requiresNativeAnchor = widget.platform == null;
    _validate();
    _platform = widget.platform ?? MethodChannelKuePlatform.instance;
    _onSubmit = widget.onSubmit;
    _onSubmitGroup = widget.onSubmitGroup;
    _captureAdapter = widget.capture;
    _cloud = widget.cloud;
    _enabled = widget.enabled;
    _offlineQueue = widget.offlineQueue;
    _recording = widget.recording;
    _callbackTimeout = widget.callbackTimeout;
    _triggers = List.unmodifiable(widget.triggers);
    _triggerIds = List.generate(
      widget.triggers.length,
      (_) => newKueReportId(),
    );
    _controller._host = this;
    _platform.register(_sessionId, _handleNative);
    WidgetsBinding.instance.addObserver(this);
    _ready = _attach();
    unawaited(
      _ready.catchError((Object error) {
        _notify(widget.onError, _error(error));
      }),
    );
  }

  Future<void> _attach() async {
    await WidgetsBinding.instance.endOfFrame;
    if (!_alive) return;
    _attachedLocale = _locale;
    await _platform
        .invoke('attach', {'sessionId': _sessionId, 'config': _config()})
        .timeout(_callbackTimeout);
    if (_alive) {
      final current = await _platform.invoke('state', {
        'sessionId': _sessionId,
      });
      if (_alive && current != null) _state(kueNativeMap(current));
    }
  }

  KueLocale get _locale {
    if (widget.locale case final locale?) return locale;
    for (final locale in WidgetsBinding.instance.platformDispatcher.locales) {
      if (locale.languageCode == 'ja') return KueLocale.ja;
      if (locale.languageCode == 'en') return KueLocale.en;
    }
    return KueLocale.en;
  }

  Map<String, Object?> _config() => {
    'enabled': _enabled,
    'locale': _locale.name,
    'buttonDesign': widget.buttonDesign.name,
    'context': widget.context?.toJson() ?? const <String, Object>{},
    'recording': _recording.name,
    'offlineQueue': _offlineQueue,
    'floatingButton': widget.floatingButton,
    'shakeTrigger': widget.shakeTrigger,
    'systemScreenshotTrigger': widget.systemScreenshotTrigger,
    'hasOnSubmit': _onSubmit != null,
    'hasOnSubmitGroup': _onSubmitGroup != null,
    'handlerId': _onSubmit == null ? null : _handlerId,
    'groupHandlerId': _onSubmitGroup == null ? null : _groupHandlerId,
    'submitLabel': widget.submitLabel,
    'groupSubmitLabel': widget.groupSubmitLabel,
    'triggerIds': _triggerIds,
    'callbackTimeoutMs': _callbackTimeout.inMilliseconds,
    if (_cloud case final cloud?)
      'cloud': {
        'apiBaseUrl': cloud.apiBaseUrl,
        'projectKey': cloud.projectKey,
        'timeoutMs': cloud.timeout.inMilliseconds,
        'allowDevelopmentLocalhostHttp': cloud.allowDevelopmentLocalhostHttp,
      },
  };
  bool _sameCloud(KueCloudConfig? a, KueCloudConfig? b) =>
      a == b ||
      (a != null &&
          b != null &&
          a.apiBaseUrl == b.apiBaseUrl &&
          a.projectKey == b.projectKey &&
          a.timeout == b.timeout &&
          a.allowDevelopmentLocalhostHttp == b.allowDevelopmentLocalhostHttp);
  @override
  void didUpdateWidget(KueHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    final enabledChanged = _enabled != widget.enabled;
    _enabled = widget.enabled;
    final recordingChanged = _recording != widget.recording;
    _recording = widget.recording;
    if (enabledChanged && !_enabled) {
      _captureCancelled = true;
      for (final operation in _operations.values) {
        if (!operation.isCompleted) {
          operation.complete(KueReportOutcome.cancelled);
        }
      }
      // Opt-out is applied even when another configuration change is rejected.
      unawaited(_update());
    }
    if (recordingChanged && _recording == KueRecordingMode.off) {
      unawaited(_update());
    }
    if (widget.controller != _controller ||
        (widget.platform ?? MethodChannelKuePlatform.instance) != _platform ||
        _offlineQueue != widget.offlineQueue ||
        !_sameCloud(_cloud, widget.cloud) ||
        _onSubmit != widget.onSubmit ||
        _onSubmitGroup != widget.onSubmitGroup ||
        !listEquals(_triggers, widget.triggers) ||
        _captureAdapter != widget.capture ||
        _callbackTimeout != widget.callbackTimeout) {
      _notify(
        widget.onError,
        const KueCloudError(
          'KUE session configuration is immutable. Explicitly discard any in-memory draft and remount KueHost with a new key to change its destination, handlers, capture, offline queue or custom triggers.',
          code: 'configuration_changed',
        ),
      );
      return;
    }
    try {
      _validate();
    } catch (error) {
      _notify(
        widget.onError,
        const KueCloudError(
          "Invalid KUE host configuration.",
          code: "invalid_config",
        ),
      );
      return;
    }
    unawaited(_update());
  }

  Future<void> _update() async {
    try {
      await _ready;
      if (!_alive) return;
      _attachedLocale = _locale;
      await _platform.invoke('update', {
        'sessionId': _sessionId,
        'config': _config(),
      });
    } catch (error) {
      if (_alive) _notify(widget.onError, _error(error));
    }
  }

  @override
  void didChangeLocales(List<Locale>? locales) {
    if (widget.locale == null && _attachedLocale != _locale) {
      unawaited(_update());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    // Native code distinguishes owned consent/inactivity from background.
  }

  Future<Object?> _invoke(
    String method, [
    Map<String, Object?> arguments = const {},
  ]) async {
    await _ready;
    if (!_alive) throw PlatformException(code: 'request_cancelled');
    return _platform.invoke(method, {'sessionId': _sessionId, ...arguments});
  }

  Future<KueReportOutcome> _reportIssue(
    String memo,
    KueContextOverrides? context,
  ) async {
    if (!_alive || !_enabled || !_foreground) return KueReportOutcome.disabled;
    if (_operations.isNotEmpty) return KueReportOutcome.busy;
    final id = newKueReportId(), completion = Completer<KueReportOutcome>();
    _operations[id] = completion;
    // Listen to the outcome before invoking native code; a capture failure can
    // arrive before the command acknowledgement.
    unawaited(
      _invoke('reportIssue', {
        'operationId': id,
        'memo': memo,
        'context': context?.toJson() ?? const <String, Object>{},
      }).then<void>(
        (_) {},
        onError: (Object error, StackTrace stack) {
          if (!completion.isCompleted) {
            if (error is PlatformException &&
                const [
                  'disabled',
                  'busy',
                  'request_cancelled',
                ].contains(error.code)) {
              completion.complete(
                error.code == 'busy'
                    ? KueReportOutcome.busy
                    : error.code == 'disabled'
                    ? KueReportOutcome.disabled
                    : KueReportOutcome.cancelled,
              );
            } else {
              completion.completeError(_error(error), stack);
            }
          }
        },
      ),
    );
    try {
      return await completion.future;
    } finally {
      _operations.remove(id);
    }
  }

  Future<Object?> _handleNative(
    String method,
    Map<String, Object?> arguments,
  ) async {
    if (!_alive) throw PlatformException(code: 'request_cancelled');
    switch (method) {
      case 'capture':
        return _capture(arguments);
      case 'submit':
        return _submit(arguments, group: false);
      case 'submitGroup':
        return _submit(arguments, group: true);
      case 'subscribeTrigger':
        return _subscribe(arguments);
      case 'unsubscribeTrigger':
        await _subscriptions.remove(arguments['subscriptionId'])?.stop();
        return const {'ok': true};
      case 'event':
        _event(arguments);
        return const {'ok': true};
      default:
        throw MissingPluginException('Unknown KUE core callback.');
    }
  }

  Future<Object?> _capture(Map<String, Object?> arguments) async {
    if (arguments['operationId'] is! String || _capturing) {
      throw PlatformException(code: 'busy');
    }
    _capturing = true;
    _captureOperationId = arguments['operationId'] as String;
    _captureCancelled = false;
    ui.Image? image;
    try {
      await WidgetsBinding.instance.endOfFrame;
      if (!_alive || !_enabled || _captureCancelled) {
        throw PlatformException(code: 'request_cancelled');
      }
      final target = _captureKey.currentContext?.findRenderObject();
      if (target is! RenderRepaintBoundary ||
          target.size.isEmpty ||
          (kDebugMode && target.debugNeedsPaint)) {
        throw PlatformException(code: 'capture_unavailable');
      }
      final size = target.size;
      Uint8List bytes;
      DateTime capturedAt;
      if (_captureAdapter case final adapter?) {
        final captured = await adapter().timeout(_callbackTimeout);
        bytes = captured.pngBytes;
        capturedAt = captured.capturedAt;
        if (bytes.length > 10 * 1024 * 1024 ||
            bytes.length < 24 ||
            !listEquals(bytes.take(8).toList(), const [
              137,
              80,
              78,
              71,
              13,
              10,
              26,
              10,
            ])) {
          throw PlatformException(code: 'capture_unavailable');
        }
        final header = ByteData.sublistView(bytes);
        final width = header.getUint32(16), height = header.getUint32(20);
        if (width == 0 || height == 0 || width * height > 16000000) {
          throw PlatformException(code: 'capture_unavailable');
        }
        final codec = await ui.instantiateImageCodec(bytes);
        try {
          image = (await codec.getNextFrame()).image;
        } finally {
          codec.dispose();
        }
      } else {
        if (!mounted) throw PlatformException(code: 'request_cancelled');
        final ratio = math.min(
          MediaQuery.devicePixelRatioOf(context),
          2048 / math.max(size.width, size.height),
        );
        image = await target.toImage(pixelRatio: ratio);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        if (data == null) throw PlatformException(code: 'capture_unavailable');
        bytes = data.buffer.asUint8List();
        capturedAt = DateTime.now().toUtc();
      }
      if (!_alive || !_enabled || _captureCancelled) {
        throw PlatformException(code: 'request_cancelled');
      }
      if (image.width * image.height > 16000000 ||
          bytes.length > 10 * 1024 * 1024) {
        throw PlatformException(code: 'capture_unavailable');
      }
      return {
        'mediaBytes': bytes,
        'mimeType': 'image/png',
        'capturedAt': capturedAt.toUtc().toIso8601String(),
        'context': {'screenWidth': size.width, 'screenHeight': size.height},
      };
    } catch (error) {
      throw _platformError(error, 'capture_unavailable');
    } finally {
      image?.dispose();
      _capturing = false;
      _captureOperationId = null;
    }
  }

  Future<Object?> _submit(
    Map<String, Object?> arguments, {
    required bool group,
  }) async {
    try {
      if (arguments['handlerId'] != (group ? _groupHandlerId : _handlerId)) {
        throw PlatformException(code: 'configuration_changed');
      }
      if (group) {
        final callback = _onSubmitGroup;
        if (callback == null) {
          throw PlatformException(code: 'configuration_changed');
        }
        final raw = kueNativeMap(arguments['group']);
        _checkCallbackBytes(raw, group: true);
        final report = KueReportGroup.fromNative(raw);
        await Future<void>.sync(
          () => callback(report),
        ).timeout(_callbackTimeout);
      } else {
        final callback = _onSubmit;
        if (callback == null) {
          throw PlatformException(code: 'configuration_changed');
        }
        final raw = kueNativeMap(arguments['report']);
        _checkCallbackBytes(raw, group: false);
        final report = KueLocalReport.fromNative(raw);
        await Future<void>.sync(
          () => callback(report),
        ).timeout(_callbackTimeout);
      }
      if (!_alive || !_enabled) {
        throw PlatformException(code: 'request_cancelled');
      }
      return const {'ok': true};
    } catch (error) {
      throw _platformError(error, 'local_save_failed');
    }
  }

  void _checkCallbackBytes(Map<String, Object?> value, {required bool group}) {
    final entries = group ? value['findings'] : [value];
    if (entries is! List || entries.isEmpty || entries.length > 10) {
      throw PlatformException(code: 'unexpected_response');
    }
    var total = 0;
    for (final entry in entries) {
      final bytes = kueNativeMap(entry)['mediaBytes'];
      if (bytes is! Uint8List) {
        throw PlatformException(code: 'unexpected_response');
      }
      total += bytes.length;
      if (total > 20 * 1024 * 1024) {
        throw PlatformException(code: 'callback_payload_too_large');
      }
    }
  }

  Future<Object?> _subscribe(Map<String, Object?> arguments) async {
    final index = _triggerIds.indexOf(arguments['triggerId'] as String? ?? ''),
        id = arguments['subscriptionId'];
    if (index < 0 || id is! String || _subscriptions.containsKey(id)) {
      throw PlatformException(code: 'trigger_setup_failed');
    }
    final subscription = _TriggerSubscription();
    _subscriptions[id] = subscription;
    final setup = Future<KueTriggerCleanup>.sync(
      () => _triggers[index](() {
        if (!_alive || !subscription.active) return;
        unawaited(
          _platform
              .invoke('trigger', {
                'sessionId': _sessionId,
                'subscriptionId': id,
              })
              .catchError((Object error) {
                if (_alive && subscription.active) {
                  _notify(widget.onError, _error(error));
                }
                return null;
              }),
        );
      }),
    );
    unawaited(
      setup.then((cleanup) async {
        if (!_alive || !subscription.active) {
          await _TriggerSubscription.release(cleanup);
        } else {
          subscription.cleanup = cleanup;
        }
      }, onError: (Object _) {}),
    );
    try {
      await setup.timeout(_callbackTimeout);
      if (!_alive || !subscription.active) {
        throw PlatformException(code: 'request_cancelled');
      }
    } catch (error) {
      _subscriptions.remove(id);
      await subscription.stop();
      throw _platformError(error, 'trigger_setup_failed');
    }
    return const {'ok': true};
  }

  void _state(Map<String, Object?> value) {
    final state = KueRuntimeState.fromNative(value);
    if (_controller.state.value == state) return;
    _controller.state.value = state;
    try {
      widget.onState?.call(state);
    } catch (_) {}
  }

  void _event(Map<String, Object?> value) {
    try {
      switch (value['type']) {
        case 'state':
          _state(kueNativeMap(value['state'] ?? value));
        case 'receipt':
          final receipt = KueReceipt.fromNative(kueNativeMap(value['receipt']));
          try {
            widget.onReceipt?.call(receipt);
          } catch (error) {
            _notify(widget.onError, error);
          }
        case 'queued':
          final id = value['clientReportId'];
          if (id is! String) {
            throw PlatformException(code: 'unexpected_response');
          }
          try {
            widget.onQueued?.call(id);
          } catch (error) {
            _notify(widget.onError, error);
          }
        case 'error':
          _notify(widget.onError, _error(value['error'] ?? value));
        case 'outcome':
          if (value['operationId'] == _captureOperationId &&
              const [
                'cancelled',
                'disabled',
                'failed',
              ].contains(value['outcome'])) {
            _captureCancelled = true;
          }
          final completion = _operations[value['operationId']];
          if (completion == null || completion.isCompleted) return;
          final outcome = value['outcome'];
          if (outcome == 'failed') {
            completion.completeError(
              _error(value['error']),
              StackTrace.current,
            );
          } else {
            KueReportOutcome? result;
            for (final candidate in KueReportOutcome.values) {
              if (candidate.name == outcome) result = candidate;
            }
            if (result == null) {
              completion.completeError(
                const KueCloudError(
                  'Invalid native outcome.',
                  code: 'unexpected_response',
                ),
                StackTrace.current,
              );
              return;
            }
            completion.complete(result);
          }
        default:
          throw PlatformException(code: 'unexpected_response');
      }
    } catch (error) {
      _notify(widget.onError, _error(error));
    }
  }

  KueCloudError _error(Object? error) {
    if (error is KueCloudError) return error;
    final details = error is PlatformException && error.details is Map
        ? kueNativeMap(error.details)
        : error is Map
        ? kueNativeMap(error)
        : const <String, Object?>{};
    final candidate = error is PlatformException ? error.code : details['code'];
    final code =
        candidate is String &&
            RegExp(r'^[A-Za-z0-9._-]{1,64}$').hasMatch(candidate)
        ? candidate
        : error is MissingPluginException
        ? 'native_plugin_missing'
        : 'native_error';
    final delay = details['retryAfterMs'];
    final safeDelay =
        delay == null ||
        (delay is int && delay >= 0 && delay <= _maxNativeRetryAfterMs);
    return KueCloudError(
      'KUE native operation failed.',
      code: code,
      retryable: details['retryable'] == true && safeDelay,
      status: details['status'] is int ? details['status'] as int : null,
      serverCode: details['serverCode'] is String
          ? details['serverCode'] as String
          : null,
      retryAfter: safeDelay && delay is int
          ? Duration(milliseconds: delay)
          : null,
    );
  }

  PlatformException _platformError(Object error, String fallback) {
    if (error is PlatformException) return error;
    final failure = error is TimeoutException
        ? const KueCloudError(
            'KUE callback timed out.',
            code: 'request_timeout',
            retryable: true,
          )
        : error is KueCloudError
        ? error
        : KueCloudError(
            'Local KUE operation failed.',
            code: fallback,
            retryable: fallback == 'local_save_failed',
          );
    return PlatformException(
      code: failure.code,
      message: 'KUE operation failed.',
      details: {
        'retryable': failure.retryable,
        if (failure.status != null) 'status': failure.status,
        if (failure.serverCode != null) 'serverCode': failure.serverCode,
        if (failure.retryAfter != null)
          'retryAfterMs': failure.retryAfter!.inMilliseconds,
      },
    );
  }

  @override
  void deactivate() {
    if (_controller._host == this) _controller._host = null;
    super.deactivate();
  }

  @override
  void activate() {
    super.activate();
    _validate();
    _controller._host = this;
  }

  @override
  void dispose() {
    _alive = false;
    WidgetsBinding.instance.removeObserver(this);
    if (_controller._host == this || _controller._host == null) {
      _controller._host = null;
      _controller.state.value = const KueRuntimeState();
    }
    for (final operation in _operations.values) {
      if (!operation.isCompleted) {
        operation.complete(KueReportOutcome.cancelled);
      }
    }
    for (final subscription in _subscriptions.values) {
      unawaited(subscription.stop());
    }
    _subscriptions.clear();
    _platform.unregister(_sessionId);
    unawaited(
      _platform
          .invoke('detach', {'sessionId': _sessionId})
          .catchError((Object _) => null),
    );
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final capture = RepaintBoundary(key: _captureKey, child: widget.child);
    if (!_requiresNativeAnchor ||
        kIsWeb ||
        defaultTargetPlatform != TargetPlatform.iOS) {
      return capture;
    }
    return Stack(
      fit: StackFit.passthrough,
      children: [
        capture,
        Positioned(
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          child: IgnorePointer(
            child: ExcludeSemantics(
              child: UiKitView(
                viewType: 'dev.kue.qa/host',
                creationParams: {'sessionId': _sessionId},
                creationParamsCodec: const StandardMessageCodec(),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _TriggerSubscription {
  bool active = true;
  KueTriggerCleanup? cleanup;
  Future<void> stop() async {
    if (!active) return;
    active = false;
    final callback = cleanup;
    cleanup = null;
    if (callback != null) await release(callback);
  }

  static Future<void> release(KueTriggerCleanup callback) async {
    try {
      await callback();
    } catch (_) {
      /* Teardown always continues. */
    }
  }
}
