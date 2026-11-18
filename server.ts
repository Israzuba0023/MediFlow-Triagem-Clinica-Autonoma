import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createMediFlowApp } from './src/server/app.ts';

// Porta padrão exigida pelo ambiente e modo de execução (desenvolvimento vs produção)
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Inicializa o servidor HTTP principal do MediFlow:
 * - Em desenvolvimento: monta o Vite em modo middleware para servir o SPA React junto da API.
 * - Em produção Node: serve os arquivos estáticos compilados da pasta `dist` com fallback SPA.
 */
async function bootstrap(): Promise<void> {
  const app = createMediFlowApp();

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor MediFlow ativo em http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Falha crítica ao iniciar o servidor MediFlow:', err);
  process.exit(1);
});
