import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: [
    'skills/addyosmani*/**',
    'skills/android*/**',
    'skills/anthropic*/**',
    'skills/antfu*/**',
    'skills/awesome-copilot*/**',
    'skills/mattpocock*/**',
    'skills/open-wot*/**',
    'skills/openai*/**',
    'skills/skillx*/**',
    'skills/vuejs-ai*/**',
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
