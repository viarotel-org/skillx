import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: [
    'skills/*/**',
    '!skills/local/**',
  ],
  markdown: {
    overrides: {
      'perfectionist/sort-imports': 'off',
      'style/block-spacing': 'off',
      'style/space-before-blocks': 'off',
    },
  },
  rules: {
    'jsdoc/require-property-description': 'off',
    'jsdoc/require-returns-description': 'off',
  },
})
