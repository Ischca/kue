module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {
        sourceDir: 'android',
        packageImportPath: 'import dev.kue.qa.reactnative.KuePackage;',
        packageInstance: 'new KuePackage()',
      },
    },
  },
};
