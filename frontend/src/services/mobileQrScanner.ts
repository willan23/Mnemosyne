import { Capacitor } from '@capacitor/core';
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';

export const scanMobilePairingQr = async (): Promise<string> => {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('A leitura por câmara está disponível na app mobile. No browser, cola o convite manualmente.');
  }

  const support = await BarcodeScanner.isSupported();
  if (!support.supported) {
    throw new Error('Este dispositivo não suporta leitura de QR pela câmara.');
  }

  if (Capacitor.getPlatform() === 'android') {
    const module = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!module.available) {
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      throw new Error('O módulo de leitura QR está a ser instalado. Tenta novamente dentro de instantes.');
    }
  } else {
    const permissions = await BarcodeScanner.checkPermissions();
    if (permissions.camera !== 'granted') {
      const requested = await BarcodeScanner.requestPermissions();
      if (requested.camera !== 'granted') {
        throw new Error('Permissão de câmara recusada.');
      }
    }
  }

  const result = await BarcodeScanner.scan({
    formats: [BarcodeFormat.QrCode],
    autoZoom: true,
  });
  const rawValue = result.barcodes.find((barcode) => barcode.rawValue)?.rawValue;
  if (!rawValue) {
    throw new Error('Nenhum QR válido foi lido.');
  }
  return rawValue;
};
