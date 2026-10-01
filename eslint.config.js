// Dev-only lint config (flat config). Run: npx eslint js
// Uses @eslint/js "recommended" when it is installed, otherwise the core of it inline.
let recommended = {
  'constructor-super': 'error', 'for-direction': 'error', 'getter-return': 'error',
  'no-async-promise-executor': 'error', 'no-case-declarations': 'error', 'no-class-assign': 'error',
  'no-compare-neg-zero': 'error', 'no-cond-assign': 'error', 'no-const-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }], 'no-debugger': 'error', 'no-dupe-args': 'error',
  'no-dupe-class-members': 'error', 'no-dupe-else-if': 'error', 'no-dupe-keys': 'error',
  'no-duplicate-case': 'error', 'no-empty': ['error', { allowEmptyCatch: true }], 'no-empty-pattern': 'error',
  'no-ex-assign': 'error', 'no-fallthrough': 'error', 'no-func-assign': 'error', 'no-import-assign': 'error',
  'no-inner-declarations': 'error', 'no-invalid-regexp': 'error', 'no-loss-of-precision': 'error',
  'no-misleading-character-class': 'error', 'no-new-native-nonconstructor': 'error', 'no-obj-calls': 'error',
  'no-prototype-builtins': 'error', 'no-redeclare': 'error', 'no-self-assign': 'error',
  'no-setter-return': 'error', 'no-shadow-restricted-names': 'error', 'no-sparse-arrays': 'error',
  'no-this-before-super': 'error', 'no-undef': 'error', 'no-unreachable': 'error', 'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error', 'no-unsafe-optional-chaining': 'error', 'no-unused-labels': 'error',
  'no-unused-vars': ['error', { args: 'none' }], 'no-useless-catch': 'error', 'no-useless-escape': 'error',
  'no-with': 'error', 'require-yield': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
};
try {
  const js = (await import('@eslint/js')).default;
  recommended = { ...js.configs.recommended.rules, 'no-unused-vars': ['error', { args: 'none' }] };
} catch { /* fall back to the inline list */ }

const browser = Object.fromEntries([
  'window', 'document', 'location', 'navigator', 'console', 'performance', 'localStorage',
  'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'fetch', 'Image', 'HTMLCanvasElement', 'OffscreenCanvas', 'URLSearchParams',
  'AudioContext', 'webkitAudioContext', 'PeriodicWave', 'addEventListener', 'removeEventListener',
  'devicePixelRatio', 'innerWidth', 'innerHeight', 'ImageData', 'KeyboardEvent', 'MouseEvent', 'URL',
].map((g) => [g, 'readonly']));

export default [
  {
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: browser },
    rules: recommended,
  },
];
