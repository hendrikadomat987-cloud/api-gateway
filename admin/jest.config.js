/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^next/cache$':      '<rootDir>/__mocks__/next-cache.ts',
    '^next/navigation$': '<rootDir>/__mocks__/next-navigation.ts',
  },
};

module.exports = config;
