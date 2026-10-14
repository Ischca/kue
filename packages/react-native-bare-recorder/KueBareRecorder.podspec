require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'KueBareRecorder'
  s.version = package['version']
  s.summary = 'Optional KUE recorder for React Native without Expo.'
  s.homepage = 'https://github.com/Ischca/kue'
  s.license = { :type => 'MIT', :file => 'ios/LICENSE' }
  s.author = 'KUE contributors'
  s.source = { :git => 'https://github.com/Ischca/kue.git', :tag => "v#{s.version}" }
  s.source_files = 'ios/*.{h,mm,swift}', 'ios/Sources/**/*.swift'
  s.ios.deployment_target = min_ios_version_supported
  s.swift_version = '5.0'
  s.module_name = 'KueBareRecorder'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_OBJC_INTERFACE_HEADER_NAME' => 'KueBareRecorder-Swift.h' }
  s.dependency 'KueBare', '= 0.6.0'
  install_modules_dependencies(s)
end
