import 'dart:async';
import 'package:flutter/services.dart';
import 'models.dart';

typedef KueNativeHandler =
    Future<Object?> Function(String method, Map<String, Object?> arguments);

/// Injectable channel boundary. Production requires the native core plugin.
abstract interface class KuePlatform {
  void register(String sessionId, KueNativeHandler handler);
  void unregister(String sessionId);
  Future<Object?> invoke(String method, Map<String, Object?> arguments);
}

class MethodChannelKuePlatform implements KuePlatform {
  MethodChannelKuePlatform({
    MethodChannel channel = const MethodChannel('dev.kue.qa/core'),
  }) : _channel = channel {
    _channel.setMethodCallHandler(_handle);
  }
  static final instance = MethodChannelKuePlatform();
  final MethodChannel _channel;
  final _handlers = <String, KueNativeHandler>{};
  @override
  void register(String sessionId, KueNativeHandler handler) {
    if (_handlers.containsKey(sessionId)) {
      throw StateError('A native KUE session is already registered.');
    }
    _handlers[sessionId] = handler;
  }

  @override
  void unregister(String sessionId) => _handlers.remove(sessionId);
  @override
  Future<Object?> invoke(String method, Map<String, Object?> arguments) =>
      _channel.invokeMethod<Object?>(method, arguments);
  Future<Object?> _handle(MethodCall call) async {
    final arguments = kueNativeMap(call.arguments),
        sessionId = arguments['sessionId'];
    final handler = sessionId is String ? _handlers[sessionId] : null;
    if (handler == null) {
      if (call.method == 'event') return const {'ok': true};
      throw PlatformException(code: 'request_cancelled');
    }
    return handler(call.method, arguments);
  }
}

Map<String, Object?> kueNativeMap(Object? value) {
  if (value is! Map || value.keys.any((key) => key is! String)) {
    throw PlatformException(code: 'unexpected_response');
  }
  return value.cast<String, Object?>();
}

/// Metadata-only state; media is sent only to submission callbacks.
class KueRuntimeState {
  const KueRuntimeState({
    this.attached = false,
    this.enabled = false,
    this.savedCount = 0,
    this.pendingCount = 0,
    this.groupLocked = false,
    this.groupFull = false,
    this.recordingAvailability = KueRecordingAvailability.cloudRequired,
    this.recordingActive = false,
    this.recorderIncluded = false,
  });
  final bool attached,
      enabled,
      groupLocked,
      groupFull,
      recordingActive,
      recorderIncluded;
  final int savedCount, pendingCount;
  final KueRecordingAvailability recordingAvailability;
  @override
  bool operator ==(Object other) =>
      other is KueRuntimeState &&
      attached == other.attached &&
      enabled == other.enabled &&
      savedCount == other.savedCount &&
      pendingCount == other.pendingCount &&
      groupLocked == other.groupLocked &&
      groupFull == other.groupFull &&
      recordingAvailability == other.recordingAvailability &&
      recordingActive == other.recordingActive &&
      recorderIncluded == other.recorderIncluded;
  @override
  int get hashCode => Object.hash(
    attached,
    enabled,
    savedCount,
    pendingCount,
    groupLocked,
    groupFull,
    recordingAvailability,
    recordingActive,
    recorderIncluded,
  );
  factory KueRuntimeState.fromNative(Map<String, Object?> value) {
    int count(String key) {
      final count = value[key] ?? 0;
      if (count is! int || count < 0 || count > 10) {
        throw PlatformException(code: 'unexpected_response');
      }
      return count;
    }

    bool flag(String key, {bool fallback = false}) {
      final flag = value[key] ?? fallback;
      if (flag is! bool) throw PlatformException(code: 'unexpected_response');
      return flag;
    }

    final availability = value['recordingAvailability'] ?? 'cloud_required';
    if (availability is! String ||
        !const {
          'off',
          'cloud_required',
          'checking',
          'check_failed',
          'upgrade',
          'unavailable',
          'rebuild',
          'ready',
        }.contains(availability)) {
      throw PlatformException(code: 'unexpected_response');
    }
    return KueRuntimeState(
      attached: true,
      enabled: flag('enabled', fallback: true),
      savedCount: count('savedCount'),
      pendingCount: count('pendingCount'),
      groupLocked: flag('groupLocked'),
      groupFull: flag('groupFull'),
      recordingAvailability: KueRecordingAvailability.fromWire(availability),
      recordingActive: flag('recordingActive'),
      recorderIncluded: flag('recorderIncluded'),
    );
  }
}
