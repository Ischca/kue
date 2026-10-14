import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import 'models.dart';

class KueCloudConfig {
  const KueCloudConfig({
    required this.apiBaseUrl,
    required this.projectKey,
    this.timeout = const Duration(seconds: 15),
    this.allowDevelopmentLocalhostHttp = false,
  });
  final String apiBaseUrl;
  final String projectKey;
  final Duration timeout;
  final bool allowDevelopmentLocalhostHttp;

  Uri endpoint({bool development = kDebugMode}) {
    final uri = Uri.tryParse(apiBaseUrl.trim());
    final local =
        uri != null &&
        const {'localhost', '127.0.0.1', '::1'}.contains(uri.host);
    if (uri == null ||
        !uri.hasAuthority ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        (uri.path.isNotEmpty && uri.path != '/') ||
        uri.hasQuery ||
        uri.hasFragment ||
        (uri.scheme != 'https' &&
            !(kDebugMode &&
                development &&
                allowDevelopmentLocalhostHttp &&
                local &&
                uri.scheme == 'http')) ||
        !RegExp(r'^pk_[A-Za-z0-9_-]{8,128}$').hasMatch(projectKey.trim()) ||
        timeout.inMilliseconds < 1 ||
        timeout.inMicroseconds % 1000 != 0 ||
        timeout > const Duration(seconds: 120)) {
      throw const KueCloudError(
        'Use an HTTPS origin, a valid project key, and a timeout of 1–120000 ms. Debug HTTP is restricted to localhost.',
        code: 'invalid_config',
      );
    }
    return uri.replace(path: '/v1/reports');
  }
}

/// Exact immutable multipart bytes and stable ID. Reuse this instance for retries.
class KuePreparedReport {
  KuePreparedReport._(this.report, this.contentType, Uint8List body)
    : body = body.asUnmodifiableView(),
      clientReportId = report.clientReportId;
  final KueLocalReport report;
  final String contentType;
  final Uint8List body;
  final String clientReportId;
}

class KuePreparedReportGroup {
  KuePreparedReportGroup._(this.group, this.contentType, Uint8List body)
    : body = body.asUnmodifiableView(),
      clientReportId = group.clientReportId;
  final KueReportGroup group;
  final String contentType;
  final Uint8List body;
  final String clientReportId;
}

void _invalid(String message) =>
    throw KueCloudError(message, code: 'invalid_report');
bool _validSize(KueImageSize size) =>
    size.width > 0 &&
    size.height > 0 &&
    size.width <= 100000 &&
    size.height <= 100000;
void _validateFinding(KueFinding finding) {
  if (!RegExp(r'^[A-Za-z0-9._~-]{16,128}$').hasMatch(finding.clientReportId) ||
      finding.memo.isEmpty ||
      finding.memo.contains('\u0000') ||
      utf8.encode(finding.memo).length > 4096 ||
      !_validSize(finding.outputSize) ||
      !const ['ios', 'android'].contains(finding.context.platform)) {
    _invalid('A finding requires a valid ID, memo, sizes and platform.');
  }
  for (final entry in finding.context.toJson().entries) {
    final value = entry.value;
    final limit = entry.key == 'route'
        ? 2048
        : entry.key == 'deviceModel'
        ? 256
        : 128;
    if ((value is String && utf8.encode(value).length > limit) ||
        (value is num && (!value.isFinite || value <= 0 || value > 100000))) {
      _invalid('Report context is invalid.');
    }
  }
  final bytes = finding.mediaBytes;
  if (finding is KueLocalReport) {
    final png =
        finding.mimeType == 'image/png' &&
        bytes.length >= 8 &&
        listEquals(bytes.take(8).toList(), const [
          137,
          80,
          78,
          71,
          13,
          10,
          26,
          10,
        ]);
    final jpeg =
        finding.mimeType == 'image/jpeg' &&
        bytes.length >= 3 &&
        bytes[0] == 255 &&
        bytes[1] == 216 &&
        bytes[2] == 255;
    if ((!png && !jpeg) ||
        bytes.length > 10 * 1024 * 1024 ||
        !finding.crop.isValid ||
        !_validSize(finding.sourceSize)) {
      _invalid('A screenshot requires JPEG/PNG up to 10 MiB and a valid crop.');
    }
  } else if (finding is KueVideoFinding) {
    if (finding.durationMs < 1 ||
        finding.durationMs > 60000 ||
        bytes.isEmpty ||
        bytes.length > 20 * 1024 * 1024) {
      _invalid('A video requires MP4 up to 60 seconds and 20 MiB.');
    }
    // Codec/container admission is performed by Cloud, never inferred from metadata.
  } else {
    _invalid('Unsupported finding type.');
  }
  if (utf8.encode(jsonEncode(finding.metadata)).length > 16384) {
    _invalid('Report metadata exceeds 16 KiB.');
  }
}

String _extension(KueFinding finding) => finding.isVideo
    ? 'mp4'
    : finding.mimeType == 'image/png'
    ? 'png'
    : 'jpg';

KuePreparedReport prepareKueReport(KueLocalReport report) {
  _validateFinding(report);
  final metadata = jsonEncode(report.metadata);
  final boundary = 'kue-${newKueReportId()}';
  final body = BytesBuilder(copy: false);
  void write(String value) => body.add(utf8.encode(value));
  write(
    '--$boundary\r\nContent-Disposition: form-data; name="screenshot"; filename="capture.${_extension(report)}"\r\nContent-Type: ${report.mimeType}\r\n\r\n',
  );
  body.add(report.imageBytes);
  write(
    '\r\n--$boundary\r\nContent-Disposition: form-data; name="memo"\r\n\r\n${report.memo}',
  );
  write(
    '\r\n--$boundary\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n$metadata',
  );
  write('\r\n--$boundary--\r\n');
  final bytes = body.takeBytes();
  if (bytes.length > 12 * 1024 * 1024) _invalid('Report body exceeds 12 MiB.');
  return KuePreparedReport._(
    report,
    'multipart/form-data; boundary=$boundary',
    bytes,
  );
}

KuePreparedReportGroup prepareKueReportGroup(KueReportGroup group) {
  if (!RegExp(r'^[A-Za-z0-9._~-]{16,128}$').hasMatch(group.clientReportId) ||
      group.title.isEmpty ||
      group.title.runes.length > 200 ||
      RegExp('[\r\n\u0000]').hasMatch(group.title) ||
      group.findings.isEmpty ||
      group.findings.length > 10 ||
      group.byteSize > 20 * 1024 * 1024) {
    _invalid(
      'A group requires a title up to 200 codepoints, 1–10 findings and up to 20 MiB.',
    );
  }
  for (final finding in group.findings) {
    _validateFinding(finding);
  }
  final manifest = jsonEncode(group.manifest);
  if (utf8.encode(manifest).length > 48 * 1024) {
    _invalid('Group manifest exceeds 48 KiB.');
  }
  final boundary = 'kue-${newKueReportId()}';
  final body = BytesBuilder(copy: false);
  void write(String value) => body.add(utf8.encode(value));
  write(
    '--$boundary\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n$manifest',
  );
  for (var index = 0; index < group.findings.length; index++) {
    final finding = group.findings[index];
    write(
      '\r\n--$boundary\r\nContent-Disposition: form-data; name="capture_$index"; filename="capture_$index.${_extension(finding)}"\r\nContent-Type: ${finding.mimeType}\r\n\r\n',
    );
    body.add(finding.mediaBytes);
  }
  write('\r\n--$boundary--\r\n');
  final bytes = body.takeBytes();
  if (bytes.length > 21 * 1024 * 1024) _invalid('Group body exceeds 21 MiB.');
  return KuePreparedReportGroup._(
    group,
    'multipart/form-data; boundary=$boundary',
    bytes,
  );
}

/// Standalone explicit requests. The native host separately owns screenshot outbox/lifecycle.
/// This client never polls, redirects, uploads in the background or retries automatically.
class KueCloudClient {
  const KueCloudClient(this.config, {this.development = kDebugMode});
  final KueCloudConfig config;
  final bool development;

  Future<KueReceipt> submit(
    KuePreparedReport prepared, {
    KueCancellationToken? cancellation,
  }) async => _receipt(
    await _request(
      '/v1/reports',
      202,
      body: prepared.body,
      contentType: prepared.contentType,
      clientReportId: prepared.clientReportId,
      cancellation: cancellation,
    ),
    prepared.clientReportId,
  );

  Future<KueReceipt> submitGroup(
    KuePreparedReportGroup prepared, {
    KueCancellationToken? cancellation,
  }) async => _receipt(
    await _request(
      '/v1/report-groups',
      202,
      body: prepared.body,
      contentType: prepared.contentType,
      clientReportId: prepared.clientReportId,
      cancellation: cancellation,
    ),
    prepared.clientReportId,
  );

  Future<KueProjectFeatures> getProjectFeatures({
    KueCancellationToken? cancellation,
  }) async {
    final map = await _request(
      '/v1/project/features',
      200,
      cancellation: cancellation,
    );
    try {
      return KueProjectFeatures.fromJson(map);
    } catch (_) {
      throw const KueCloudError(
        'Cloud returned invalid features.',
        code: 'unexpected_response',
        retryable: true,
        status: 200,
      );
    }
  }

  Future<KueReportStatus> getReportStatus(
    KueReceipt receipt, {
    KueCancellationToken? cancellation,
  }) async {
    if (!RegExp(r'^report_[A-Za-z0-9_-]+$').hasMatch(receipt.id) ||
        !RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(receipt.receiptToken ?? '')) {
      _invalid(
        'A status read requires a valid report ID and receipt capability.',
      );
    }
    final map = await _request(
      '/v1/reports/${receipt.id}',
      200,
      token: receipt.receiptToken,
      receiptRead: true,
      cancellation: cancellation,
    );
    try {
      return KueReportStatus.fromJson(map, expectedId: receipt.id);
    } catch (_) {
      throw const KueCloudError(
        'Cloud returned invalid report status.',
        code: 'unexpected_response',
        retryable: true,
        status: 200,
      );
    }
  }

  KueReceipt _receipt(Map map, String clientReportId) {
    if (map['id'] is! String ||
        (map['id'] as String).trim().isEmpty ||
        !const ['received', 'queued'].contains(map['status']) ||
        (map.containsKey('receiptToken') &&
            (map['receiptToken'] is! String ||
                !RegExp(
                  r'^[A-Za-z0-9_-]{43}$',
                ).hasMatch(map['receiptToken'] as String)))) {
      throw const KueCloudError(
        'Cloud returned an invalid receipt.',
        code: 'unexpected_response',
        retryable: true,
        status: 202,
      );
    }
    return KueReceipt(
      clientReportId: clientReportId,
      id: (map['id'] as String).trim(),
      status: map['status'] == 'received'
          ? KueReceiptStatus.received
          : KueReceiptStatus.queued,
      receiptToken: map['receiptToken'] as String?,
    );
  }

  Future<Map> _request(
    String path,
    int expectedStatus, {
    Uint8List? body,
    String? contentType,
    String? clientReportId,
    String? token,
    bool receiptRead = false,
    KueCancellationToken? cancellation,
  }) async {
    // Receipt reads deliberately validate no ingest key and never put it on the wire.
    final validated = receiptRead
        ? KueCloudConfig(
            apiBaseUrl: config.apiBaseUrl,
            projectKey: 'pk_status_only',
            timeout: config.timeout,
            allowDevelopmentLocalhostHttp: config.allowDevelopmentLocalhostHttp,
          )
        : config;
    final endpoint = validated
        .endpoint(development: development)
        .replace(path: path);
    final client = HttpClient();
    void abort() => client.close(force: true);
    cancellation?.addListener(abort);
    void checkCancellation() {
      if (cancellation?.isCancelled == true) {
        throw const KueCloudError('Request cancelled.', code: 'cancelled');
      }
    }

    Future<Map> send() async {
      checkCancellation();
      final request = body == null
          ? await client.getUrl(endpoint)
          : await client.postUrl(endpoint);
      request.followRedirects = false;
      request.maxRedirects = 0;
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      request.headers.set(
        HttpHeaders.authorizationHeader,
        'Bearer ${token ?? config.projectKey.trim()}',
      );
      if (body != null) {
        request.headers.set('Idempotency-Key', clientReportId!);
        request.headers.set(HttpHeaders.contentTypeHeader, contentType!);
        request.contentLength = body.length;
        request.add(body);
      }
      final response = await request.close();
      final bytes = BytesBuilder(copy: false);
      await for (final chunk in response) {
        bytes.add(chunk);
        if (bytes.length > 65536) {
          throw KueCloudError(
            'Cloud returned an oversized response.',
            code: 'unexpected_response',
            retryable: true,
            status: response.statusCode,
          );
        }
      }
      checkCancellation();
      Object? decoded;
      try {
        decoded = jsonDecode(utf8.decode(bytes.takeBytes()));
      } catch (_) {
        /* Classified below. */
      }
      final status = response.statusCode;
      if (status != expectedStatus) {
        String? serverCode;
        if (decoded is Map && decoded['error'] is Map) {
          final code = (decoded['error'] as Map)['code'];
          if (code is String &&
              RegExp(r'^[A-Za-z0-9._-]{1,64}$').hasMatch(code)) {
            serverCode = code;
          }
        }
        final quota =
            !receiptRead && status == 429 && serverCode == 'quota_exceeded';
        throw KueCloudError(
          quota
              ? 'The monthly report quota has been reached.'
              : 'Cloud rejected the request (HTTP $status).',
          code: receiptRead ? 'unexpected_response' : 'upload_rejected',
          status: status,
          serverCode: serverCode,
          retryable: (status == 429 && !quota) || status >= 500,
          retryAfter: parseKueRetryAfter(response.headers.value('retry-after')),
        );
      }
      if (decoded is! Map) {
        throw KueCloudError(
          'Cloud returned invalid JSON.',
          code: 'unexpected_response',
          retryable: true,
          status: status,
        );
      }
      return decoded;
    }

    try {
      return await send().timeout(
        config.timeout,
        onTimeout: () {
          abort();
          throw const KueCloudError(
            'Cloud did not respond in time. Retry unchanged content.',
            code: 'request_timeout',
            retryable: true,
          );
        },
      );
    } on KueCloudError {
      rethrow;
    } catch (_) {
      checkCancellation();
      throw const KueCloudError(
        'Cloud could not be reached.',
        code: 'network_error',
        retryable: true,
      );
    } finally {
      cancellation?.removeListener(abort);
      client.close(force: true);
    }
  }
}

Future<KueProjectFeatures> getKueProjectFeatures(
  KueCloudConfig config, {
  KueCancellationToken? cancellation,
}) => KueCloudClient(config).getProjectFeatures(cancellation: cancellation);
Future<KueReportStatus> getKueReportStatus(
  KueReceipt receipt,
  KueCloudConfig config, {
  KueCancellationToken? cancellation,
}) =>
    KueCloudClient(config).getReportStatus(receipt, cancellation: cancellation);

Duration? parseKueRetryAfter(String? value, {DateTime? now}) {
  if (value == null) return null;
  final seconds = double.tryParse(value);
  const maximumSeconds = 30 * 24 * 60 * 60;
  if (seconds != null && (!seconds.isFinite || seconds > maximumSeconds)) {
    throw const KueCloudError(
      'Retry-After exceeds the supported 30-day delay.',
      code: 'unexpected_response',
    );
  }
  if (seconds != null && seconds.isFinite && seconds >= 0) {
    return Duration(milliseconds: (seconds * 1000).ceil());
  }
  try {
    final date = HttpDate.parse(value);
    final duration = date.difference(now ?? DateTime.now());
    if (duration > const Duration(days: 30)) {
      throw const KueCloudError(
        'Retry-After exceeds the supported 30-day delay.',
        code: 'unexpected_response',
      );
    }
    return duration.isNegative ? Duration.zero : duration;
  } on KueCloudError {
    rethrow;
  } catch (_) {
    return null;
  }
}
