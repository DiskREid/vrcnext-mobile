import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.diskreid.vrcnextmobile',
  appName: 'VRCNext Mobile',
  webDir: 'dist',
  loggingBehavior: 'none',
  android: {
    allowMixedContent: false,
    minWebViewVersion: 109,
    webContentsDebuggingEnabled: false,
    adjustMarginsForEdgeToEdge: 'auto',
    backgroundColor: '#10131c',
  },
  server: { androidScheme: 'https' },
};
export default config;
