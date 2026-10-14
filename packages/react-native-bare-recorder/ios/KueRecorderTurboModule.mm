#import "KueRecorderTurboModule.h"
#import "KueBareRecorder-Swift.h"
@implementation KueRecorderTurboModule {
  KueRNRecorderBridge *_core;
  NSString *_engineKey;
  BOOL _invalidated;
}
+ (NSString *)moduleName { return @"NativeKueRecorder"; }
+ (BOOL)requiresMainQueueSetup { return YES; }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  _engineKey = [NSString stringWithFormat:@"%p", params.jsInvoker.get()];
  return std::make_shared<facebook::react::NativeKueRecorderSpecJSI>(params);
}
- (void)call:(BOOL)install session:(NSString *)session resolve:(RCTPromiseResolveBlock)resolve {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_invalidated) { resolve(@"{\"schemaVersion\":1,\"ok\":false,\"error\":{\"code\":\"request_cancelled\",\"retryable\":false}}"); return; }
    if (!self->_core) self->_core = [[KueRNRecorderBridge alloc] initWithEngine:self->_engineKey ?: @"uninitialized"];
    resolve(install ? [self->_core install:session] : [self->_core remove:session]);
  });
}
- (void)install:(NSString *)session resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject { [self call:YES session:session resolve:resolve]; }
- (void)remove:(NSString *)session resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject { [self call:NO session:session resolve:resolve]; }
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{ self->_invalidated = YES; [self->_core invalidate]; self->_core = nil; }); }
@end
