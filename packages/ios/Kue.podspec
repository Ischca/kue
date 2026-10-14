Pod::Spec.new do |s|
  s.name = 'Kue'
  s.version = '0.6.0'
  s.summary = 'KUE screenshot reporting, grouped findings and foreground outbox for iOS.'
  s.homepage = 'https://github.com/Ischca/kue'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = 'KUE contributors'
  # The documented CocoaPods installation uses the unpacked archive with :path.
  s.source = { :http => "https://github.com/Ischca/kue/releases/download/v#{s.version}/kue-ios-#{s.version}.zip" }
  s.source_files = 'Sources/Kue/**/*.swift'
  s.resource_bundles = { 'KueResources' => ['Sources/Kue/Resources/*.png'] }
  s.ios.deployment_target = '15.0'
  s.swift_version = '5.0'
  s.module_name = 'Kue'
end
