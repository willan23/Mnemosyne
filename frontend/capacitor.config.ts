import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.mnemosyne.mobile',
    appName: 'Mnemosyne',
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
