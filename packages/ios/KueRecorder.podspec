Pod::Spec.new do |s|
  s.name = 'KueRecorder'
  s.version = '0.6.0'
  s.summary = 'Optional silent ReplayKit H.264 recording provider for KUE on iOS.'
  s.homepage = 'https://github.com/Ischca/kue'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = 'KUE contributors'
  s.source = { :http => "https://github.com/Ischca/kue/releases/download/v#{s.version}/kue-ios-#{s.version}.zip" }
  s.source_files = 'Sources/KueRecorder/**/*.swift'
  s.dependency 'Kue', '= 0.6.0'
  s.ios.deployment_target = '15.0'
  s.swift_version = '5.0'
  s.module_name = 'KueRecorder'
end
