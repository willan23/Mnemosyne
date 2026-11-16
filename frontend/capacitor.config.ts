import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.mnemosyne.mobile',
    appName: 'Mnemosyne',
    // Plugin arguments can contain credentials. Disable Capacitor bridge logging in every build.
    loggingBehavior: 'none',
    webDir: 'dist',
    server: {
        androidScheme: 'https'
    },
    plugins: {
        SplashScreen: {
            launchShowDuration: 2000,
            backgroundColor: '#0a0a0a',
            androidScaleType: 'CENTER_CROP',
            showSpinner: false
        }
    }
};

export default config;
