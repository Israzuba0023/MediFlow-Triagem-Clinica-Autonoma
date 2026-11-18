# Backend Serverless — Netlify Functions

Esta pasta contém os adaptadores serverless executados pelo Netlify em produção:

- `functions/api.ts` — Exporta o `handler` via `serverless-http` reutilizando a aplicação Express (`src/server/app.ts`) com suporte completo a payloads binários (`PDF`, imagens e `multipart/form-data`), autenticação OAuth, criptografia AES-256-GCM e cadeia de auditoria SHA-256.
