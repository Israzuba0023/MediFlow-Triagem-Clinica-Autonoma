import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Copia src/assets para dentro de dist/ para que URLs relativas à raiz
      // (como "/src/assets/images/...") continuem funcionando após o build de produção. Não remover.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // O HMR fica desabilitado no AI Studio via variável DISABLE_HMR.
      // Não modificar — o observador de arquivos é desligado para evitar piscadas durante edições.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Desativa o file watching quando DISABLE_HMR é true para economizar CPU em edições automáticas.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
