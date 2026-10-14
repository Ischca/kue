#import "KueHostAnchorComponentView.h"
#import "KueBare-Swift.h"
#import <react/renderer/components/KueBareSpec/ComponentDescriptors.h>
#import <react/renderer/components/KueBareSpec/EventEmitters.h>
#import <react/renderer/components/KueBareSpec/Props.h>
#import <react/renderer/components/KueBareSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;
@interface KueHostAnchorComponentView () <RCTKueHostAnchorViewProtocol>
@end
@implementation KueHostAnchorComponentView {
  NSString *_sessionId;
  NSString *_owner;
}
- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto props = std::make_shared<const KueHostAnchorProps>(); _props = props;
    _owner = NSUUID.UUID.UUIDString; _sessionId = @"";
    self.userInteractionEnabled = NO; self.accessibilityElementsHidden = YES;
    self.isAccessibilityElement = NO; self.backgroundColor = UIColor.clearColor;
  }
  return self;
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<KueHostAnchorComponentDescriptor>(); }
- (void)bind {
  if (!_sessionId.length || !self.window) return;
  [KueRNAnchorBindings bind:self sessionId:_sessionId owner:_owner];
  if (_eventEmitter) static_cast<const KueHostAnchorEventEmitter &>(*_eventEmitter).onReady({ std::string(_sessionId.UTF8String) });
}
- (void)didMoveToWindow { [super didMoveToWindow]; if (self.window) [self bind]; }
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &value = *std::static_pointer_cast<KueHostAnchorProps const>(props);
  NSString *next = [NSString stringWithUTF8String:value.sessionId.c_str()];
  if (![_sessionId isEqualToString:next]) {
    if (_sessionId.length) [KueRNAnchorBindings remove:_sessionId owner:_owner];
    _sessionId = next;
  }
  [super updateProps:props oldProps:oldProps]; [self bind];
}
- (void)prepareForRecycle {
  if (_sessionId.length) [KueRNAnchorBindings remove:_sessionId owner:_owner];
  _sessionId = @""; _owner = NSUUID.UUID.UUIDString; [super prepareForRecycle];
}
@end
