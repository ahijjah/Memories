module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': ['babel-jest', { configFile: './babel.config.jest.js' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  testPathIgnorePatterns: ['/__mocks__/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  setupFilesAfterEnv: [],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^expo-file-system$': '<rootDir>/src/hooks/__tests__/__mocks__/expo-file-system.js',
    '^@clerk/clerk-expo$': '<rootDir>/src/hooks/__tests__/__mocks__/@clerk/clerk-expo.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@babel)/)',
  ],
};
