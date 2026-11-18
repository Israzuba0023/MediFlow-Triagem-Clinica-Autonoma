# Automação e Integração Contínua (GitHub Actions)

Esta pasta reúne os fluxos automatizados do repositório **MediFlow**:

- `workflows/ci-security.yml` — Pipeline **MediFlow CI & Security Gate**, executado a cada `push` ou `pull_request` na branch principal para validar tipagem TypeScript (`npm run lint`), build de produção (`npm run build`), empacotamento serverless da função Netlify (`esbuild`) e varredura preventiva contra vazamento de segredos.
