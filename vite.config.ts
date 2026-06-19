import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react({
      // React 19: Babel-Transform für JSX Runtime
      babel: {
        plugins: [
          ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }],
        ],
      },
    }),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@hooks': path.resolve(__dirname, 'src/hooks'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@engine': path.resolve(__dirname, 'src/engine'),
      '@types': path.resolve(__dirname, 'src/types'),
      '@utils': path.resolve(__dirname, 'src/utils'),
    },
  },

  build: {
    // Capacitor erwartet den Output in /dist
    outDir: 'dist',
    emptyOutDir: true,

    // Für native Apps: kein Code-Splitting (bessere Performance)
    rollupOptions: {
      output: {
        manualChunks: undefined,
        // Inline-Assets für Capacitor-Kompatibilität
        inlineDynamicImports: false,
      },
    },

    // Minifizierung
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,    // Keine console.log im Production-Build
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info'],
      },
    },

    // Source-Maps für Crash-Reporting
    sourcemap: false,

    // Chunk-Größe-Warnung erhöhen (native Apps haben kein Bandwidth-Limit)
    chunkSizeWarningLimit: 2000,
  },

  // Dev-Server (nur für Browser-Testing)
  server: {
    port: 5173,
    host: true,
    strictPort: true,
  },

  // Optimierungen
  optimizeDeps: {
    include: ['react', 'react-dom'],
    exclude: [
      '@capacitor/haptics',
      '@capacitor/preferences',
      '@capacitor-community/bluetooth-le',
    ],
  },

  // CSS
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
});
