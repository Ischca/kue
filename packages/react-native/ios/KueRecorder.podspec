require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name = 'KueRecorder'
  s.version = package['version']
  s.summary = 'Optional silent KUE screen recorder'
  s.description = s.summary
  s.license = package['license']
  s.author = 'KUE'
  s.homepage = 'https://github.com/Ischca/kue'
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/Ischca/kue.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ReplayKit', 'AVFoundation', 'AVKit'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
