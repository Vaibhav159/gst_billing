module.exports = {
  testDir: './tests',
  timeout: 90000,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  use: {
    baseURL: 'http://localhost',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  retries: 0,
  workers: 1,
  projects: [
    { name: 'setup', testMatch: '**/_auth.setup.js' },
    { name: 'main', testMatch: '**/*.spec.js', dependencies: ['setup'], use: { storageState: 'auth-state.json' } },
  ],
};
