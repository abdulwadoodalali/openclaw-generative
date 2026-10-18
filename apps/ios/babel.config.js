// babel-preset-expo is installed nested under node_modules/expo here (npm did not hoist it), and
// Babel resolves presets from this folder, so resolve it explicitly relative to the expo package.
const presetExpo = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] });

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [[presetExpo, { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
