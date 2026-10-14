#import "KueTurboModule.h"
#import "KueBare-Swift.h"

@implementation KueTurboModule {
  KueRNBridge *_core;
  NSString *_engineKey;
  BOOL _invalidated;
}
+ (NSString *)moduleName { return @"NativeKue"; }
+ (BOOL)requiresMainQueueSetup { return YES; }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  _engineKey = [NSString stringWithFormat:@"%p", params.jsInvoker.get()];
  return std::make_shared<facebook::react::NativeKueSpecJSI>(params);
}
- (KueRNBridge *)core {
  if (_core || _invalidated) return _core;
  __weak KueTurboModule *weakSelf = self;
  NSError *error = nil;
  _core = [[KueRNBridge alloc] initWithEngine:_engineKey ?: @"uninitialized" error:&error
    request:^(NSString *session, NSString *request, NSString *kind, NSString *payload) {
      [weakSelf emitOnRequest:@{@"sessionId": session, @"requestId": request, @"kind": kind, @"payload": payload}];
    } event:^(NSString *session, NSString *kind, NSString *payload) {
      [weakSelf emitOnEvent:@{@"sessionId": session, @"kind": kind, @"payload": payload}];
    }];
  return _core;
}
- (void)call:(NSString *)method session:(NSString *)session action:(NSString *)action json:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve {
  __weak KueTurboModule *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    KueTurboModule *self = weakSelf;
    if (!self || self->_invalidated) {
      resolve(@"{\"schemaVersion\":1,\"ok\":false,\"error\":{\"code\":\"request_cancelled\",\"retryable\":false}}"); return;
    }
    KueRNBridge *core = [self core];
    if (!core) { resolve(@"{\"schemaVersion\":1,\"ok\":false,\"error\":{\"code\":\"native_error\",\"retryable\":false}}"); return; }
    [core handle:method sessionId:session action:action json:json completion:^(NSString *value) { resolve(value); }];
  });
}
- (void)attach:(NSString *)session configuration:(NSString *)configuration resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self call:@"attach" session:session action:@"" json:configuration resolve:resolve];
}
- (void)update:(NSString *)session configuration:(NSString *)configuration resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self call:@"update" session:session action:@"" json:configuration resolve:resolve];
}
- (void)detach:(NSString *)session resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self call:@"detach" session:session action:@"" json:@"{\"schemaVersion\":1}" resolve:resolve];
}
- (void)execute:(NSString *)session action:(NSString *)action argumentsJson:(NSString *)arguments resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self call:@"execute" session:session action:action json:arguments resolve:resolve];
}
- (void)completeCallback:(NSString *)session requestId:(NSString *)request response:(NSString *)response {
  __weak KueTurboModule *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{ KueTurboModule *self = weakSelf; if (self && !self->_invalidated) [[self core] completeCallback:session requestId:request response:response]; });
}
- (void)standalone:(NSString *)action argumentsJson:(NSString *)arguments resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self call:@"standalone" session:@"" action:action json:arguments resolve:resolve];
}
- (void)copyMediaFile:(NSString *)session requestId:(NSString *)request uri:(NSString *)uri resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"schemaVersion": @1, @"requestId": request, @"uri": uri} options:0 error:nil];
  [self call:@"copyMediaFile" session:session action:@"" json:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] resolve:resolve];
}
- (void)removeCopiedMediaFile:(NSString *)uri resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self call:@"removeCopiedMediaFile" session:@"" action:@"" json:uri resolve:resolve];
}
- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{ self->_invalidated = YES; [self->_core invalidate]; self->_core = nil; });
}
@end
