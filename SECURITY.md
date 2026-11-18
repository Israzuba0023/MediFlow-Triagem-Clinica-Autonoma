# Política de Segurança & Conformidade — MediFlow

Este documento define os controles técnicos, operacionais e de proteção de segredos implementados para a execução segura do **MediFlow** em ambiente **Netlify** e versionamento no **GitHub**.

---

## 1. Gestão de Segredos (GitHub & Netlify)

- **Zero segredos no código-fonte**: Chaves de API, segredos OAuth e chaves mestras nunca são armazenadas em arquivos versionados. `.env`, `.env.*` (exceto `.env.example`), `.mediflow-vault/`, `.netlify/`, `*.pem` e `*.key` estão bloqueados no `.gitignore`.
- **Execução Server-Side Exclusiva**: O SDK `@google/genai` e a variável `GEMINI_API_KEY` são executados exclusivamente no backend (`/api/triage/process` via `netlify/functions/api.ts` ou `server.ts`). Nenhuma chave é enviada ou empacotada para o navegador (`VITE_*` não contém segredos).
- **Variáveis recomendadas no Netlify** (*Site Configuration → Environment variables*):
  - `GEMINI_API_KEY`: Obrigatória para o agente multimodal.
  - `SESSION_SECRET`: String aleatória de 32+ bytes (`openssl rand -hex 32`) para assinatura `HMAC-SHA256` das sessões.
  - `ENCRYPTION_MASTER_KEY`: String aleatória de 32+ bytes para cifragem `AES-256-GCM`.
  - `DISABLE_DEMO_LOGIN`: `false` (padrão para demo) ou `true` para exigir apenas OAuth real.
  - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` e `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (opcionais para SSO real).

---

## 2. Protocolos e Controles Implementados

1. **Criptografia em Repouso (`AES-256-GCM`)**: Documentos clínicos, alertas, objetos do cofre OCI e registros utilizam IV único de 96 bits e `authTag` de 128 bits.
2. **Sessão & RBAC**: Tokens assinados com `HMAC-SHA256` (`timingSafeEqual`), TTL de 8 horas, cookies `HttpOnly` + `Secure` + `SameSite` e autorização por perfil (`ADMIN_GESTOR`, `AUDITOR_CLINICO`, `OPERADOR_TRIAGEM`).
3. **Proteção OAuth & CSRF**:
   - Validação de parâmetro `state` assinado em cookie `HttpOnly` (`mediflow_oauth_state`) nos callbacks `/auth/callback/google` e `/auth/callback/github`.
   - `window.opener.postMessage` restrito estritamente ao `origin` verificado da aplicação.
   - Guarda CSRF (`csrfOriginGuard`) validando `Origin`, `Host`, `X-Forwarded-Host`, `APP_URL`, `URL` e `DEPLOY_PRIME_URL` do Netlify.
4. **Cabeçalhos de Segurança HTTP (`netlify.toml` & `helmet`)**:
   - `Strict-Transport-Security` (HSTS 1 ano + preload)
   - `Content-Security-Policy` (`object-src 'none'`, `base-uri 'self'`, `script-src 'self'`)
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy` bloqueando câmera, microfone, geolocalização e pagamento.
5. **Privacidade LGPD/HIPAA & Defesa Multimodal**:
   - Mascaramento padrão de nomes, CPF e prévias; desmascaramento auditado e restrito a Gestor/Auditor.
   - Validação binária de uploads por *magic bytes* (`%PDF-`, PNG, JPEG, WEBP, JSON), limite compatível com serverless (`4 MB` no Netlify / `10 MB` em Node) e sanitização contra XSS e Prompt Injection.
   - Proteção anti-SSRF em webhooks (apenas HTTPS público).
   - Trilha de auditoria encadeada por `SHA-256` (`prev_hash` → `entry_hash`).

---

## 3. Nota sobre Persistência Serverless no Netlify

Em execução serverless no Netlify Functions, o sistema de arquivos local é efêmero (`/tmp/.mediflow-vault`) entre *cold starts*. Para persistência durável de objetos em demonstrações prolongadas ou produção, conecte um bucket real da **Oracle Cloud Infrastructure (OCI)** via `OCI_PAR_BASE_URL` ou credenciais S3-compatíveis (`OCI_S3_ENDPOINT`, `OCI_ACCESS_KEY_ID`, `OCI_SECRET_ACCESS_KEY`).
