Pod::Spec.new do |s|
  s.name = 'kue_qa'
  s.version = '0.6.0'
  s.summary = 'KUE native reporting Flutter core integration.'
  s.homepage = 'https://github.com/Ischca/kue'
  s.license = { :type => 'MIT', :file => '../LICENSE' }
  s.author = 'KUE contributors'
  s.source = { :path => '.' }
  s.source_files = 'Sources/**/*.swift'
  s.dependency 'Flutter'
  s.resource_bundles = { 'KueResources' => ['Resources/*.png'] }
  s.ios.deployment_target = '15.0'
  s.swift_version = '5.0'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
