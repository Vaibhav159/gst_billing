import type { CapacitorConfig } from '@capacitor/cli';

// No `server.url` on purpose: a native build must load the bundled `dist/`
// output, not a remote host. (The scaffold shipped pointing at the app
// builder's hosted preview, which would have made any future APK a thin
// client of a third-party URL.)
const config: CapacitorConfig = {
  appId: 'org.cheq.gstbilling',
  appName: 'GST Billing',
  webDir: 'dist',
};

export default config;
