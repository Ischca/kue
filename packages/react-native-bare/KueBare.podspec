require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'KueBare'
  s.version = package['version']
  s.summary = 'KUE integration for React Native without Expo.'
  s.homepage = 'https://github.com/Ischca/kue'
  s.license = { :type => 'MIT', :file => 'ios/LICENSE' }
  s.author = 'KUE contributors'
  s.source = { :git => 'https://github.com/Ischca/kue.git', :tag => "v#{s.version}" }
  s.source_files = 'ios/*.{h,mm,swift}', 'ios/Sources/**/*.swift'
  s.resource_bundles = { 'KueResources' => ['ios/Sources/Native/Resources/*.png'] }
  s.ios.deployment_target = min_ios_version_supported
  s.swift_version = '5.0'
  s.module_name = 'KueBare'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_OBJC_INTERFACE_HEADER_NAME' => 'KueBare-Swift.h' }
  install_modules_dependencies(s)
end
