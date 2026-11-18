import 'dotenv/config';
import serverless from 'serverless-http';
import { createMediFlowApp } from '../../src/server/app.ts';

// Instancia a aplicação Express compartilhada com todos os middlewares de segurança
const app = createMediFlowApp();

/**
 * Handler serverless exportado para o Netlify Functions.
 * Preserva payloads binários (PDF, imagens e uploads multipart/form-data) sem corrupção de encoding.
 */
export const handler = serverless(app, {
  binary: ['application/pdf', 'image/*', 'multipart/form-data'],
});
