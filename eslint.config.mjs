// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // Base recommended configs
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettier,

  // Global settings for non-API workspaces
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['api/**'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // API workspace - use eslint-specific tsconfig
  {
    files: ['api/**/*.ts', 'api/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './api/tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
        projectService: false,
      },
    },
  },

  // Ignore patterns
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/.output/**',
      '**/coverage/**',
      '**/htmlcov/**', // Python coverage HTML
      '**/.astro/**',
      '**/scripts/**', // Python code
      '**/Music/**',
      '**/__pycache__/**',
      '*.config.js',
      '*.config.mjs',
      '**/*.d.ts', // TypeScript declaration files
      '**/*.d.ts.map',
      '**/*.js.map',
    ],
  },

  // TypeScript files
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // TypeScript-specific rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      // General code quality
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'prefer-arrow-callback': 'error',
      'no-duplicate-imports': 'error',
    },
  },

  // JavaScript files (configs, etc.)
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Test files - relaxed rules
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  }
);
