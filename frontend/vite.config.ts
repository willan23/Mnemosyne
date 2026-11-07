import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mnemosyneVersionPlugin } from './scripts/versionPlugin'
import { generationFunctionsBase } from '../functions/src/generationHttpPolicy'

function generationEndpointPreflight(): Plugin {
  return { name: 'mnemosyne-generation-endpoint', config(_config, context) {
    const env = loadEnv(context.mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
    generationFunctionsBase({ projectId: env.VITE_FIREBASE_PROJECT_ID || 'mnemosyne-one',
      development: context.command === 'serve' && context.mode !== 'production',
      emulatorOrigin: env.VITE_FIREBASE_FUNCTIONS_EMULATOR_ORIGIN || undefined })
  } }
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    generationEndpointPreflight(),
    mnemosyneVersionPlugin(),
    react(),
    tailwindcss(),
  ],

  // ─── Critical: force a single copy of React across all chunks ───────────────
  // Without this, @react-three/fiber resolves its own React instance → useLayoutEffect crash
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@react-three/fiber',
      '@react-three/drei',
    ],
  },

  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@react-three/fiber',
      '@react-three/drei',
      'three',
    ],
  },

  // ─── Tests ──────────────────────────────────────────────────────────────────
  test: {
    globals: true,
    environment: 'jsdom',
    // Bound parallel jsdom/crypto workers so the same suite remains reliable on Windows and CI.
    maxWorkers: 4,
    // Real vault crypto and complete settings dialogs can exceed five seconds under parallel load.
    testTimeout: 10000,
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'dev-dist', '../**'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'dist/',
      ],
    },
  },

  // ─── Build ──────────────────────────────────────────────────────────────────
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'zustand', 'immer'],
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          ui: ['framer-motion', 'lucide-react', 'react-hot-toast']
        }
      },
    },
  },
})
