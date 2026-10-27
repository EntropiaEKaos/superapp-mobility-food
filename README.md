# SuperApp — Mobilidade + Delivery · Sprint 01

Fundação Next.js 16 + React 19 + TypeScript + npm Workspaces + Turborepo + PostgreSQL + Prisma 7 + Better Auth. Os módulos **rides** e **food** são pacotes independentes e testáveis. Interface PT-BR com demos navegáveis, sem pagamentos e sem viagens ou pedidos reais.

## Estado REAL do projeto

- ✅ Código-base de home, simulação de estimativa de corrida, catálogo de restaurantes, páginas de login, conta e admin (admin validado pelo servidor).
- ✅ Contratos de domínio, schema SQL relacional em Prisma, APIs demonstrativas, testes unitários de regras puras, workflow GitHub Actions.
- ⚠️ Login funcional requer DATABASE_URL, migração e BETTER_AUTH_SECRET; sem isso, a interface permanece em modo demonstração. A configuração de autenticação usa o esquema padrão da Better Auth; execute `npx auth@latest generate` e **revise eventuais diferenças** antes da primeira migração.
- ❌ Não implementados: despachos ao vivo, GPS real, pagamentos, pedidos reais, provisionamento automático de motoristas, regras regulatórias e lançamento público.

## Pré-requisitos

Node >= 22.12, npm >= 10 e Docker (ou uma instância PostgreSQL gerenciada).

## Rodar local

```bash
npm install
cp .env.example apps/web/.env.local
cp .env.example packages/database/.env
# Gere BETTER_AUTH_SECRET: openssl rand -base64 32
# Insira o mesmo segredo nas duas cópias para ativar login.
docker compose up -d db
npm run db:generate
npm run db:migrate -- --name init
# Revise e versiona packages/database/prisma/migrations antes de qualquer deploy com login
npm run dev
```

Acesse `http://localhost:3000` e `http://localhost:3000/api/health`. Se quiser só testar a home/demo, basta `npm install`, `npm run db:generate`, `npm run dev` mesmo sem PostgreSQL e sem criar `.env.local`: login fica desabilitado.

## Testes

```bash
npm run check
npm run build
```

## GitHub — repositório oficial

O repositório oficial é [EntropiaEKaos/superapp-mobility-food](https://github.com/EntropiaEKaos/superapp-mobility-food). O código da Sprint 01 já está na branch `main`; propostas novas entram por Pull Request com CI. Nunca envie credenciais, arquivos `.env`, tokens ou dados reais.\n\nExecute `npm install` antes de fazer o primeiro commit para gerar `package-lock.json` e incluí-lo no Git. Enquanto não existir lockfile, o CI faz `npm install`; quando existir, faz `npm ci` para builds reproduzíveis. **Sem acesso ao registro npm neste ambiente, o lockfile e as migrações ainda não foram gerados; são passos obrigatórios antes da produção.**

## Sprint 03 e 04 — banco, login e solicitações de parceria

- **Sprint 03:** migrações SQL iniciais versionadas em `packages/database/prisma/migrations` e teste real com PostgreSQL 16 no GitHub Actions. Cadastro Better Auth, sessão persistida e restrição de administrador validados contra um banco temporário.
- **Sprint 04:** tela `/partners/apply` para **solicitar** cadastro de motorista, entregador ou restaurante (somente usuário autenticado). As solicitações são vinculadas ao dono, com status `PENDING`, limite de uma por modalidade e sem promoção automática de permissões.
- `GET /api/partners/applications` lista **somente** inscrições da conta logada; `POST /api/partners/applications` valida dados e registra uma solicitação pendente.
- Nenhum motorista ou restaurante entra em operação por este cadastro; antes do lançamento serão exigidos aprovação administrativa, documentos, conformidade legal e controles antiabuso.

**Produção:** aplique migrações apenas via release controlado e use `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` e `NEXT_PUBLIC_APP_URL` no ambiente de deploy. O README descreve demonstração; os testes usam apenas banco temporário e identidades fictícias.

## Sprint 02 — demonstração interativa

- Cardápio com controles de quantidade, carrinho local e subtotal. Sem envio de pedidos ou pagamentos.
- `node scripts/smoke.mjs` verifica a home, catálogo, cardápio, estimativa, validação de entrada e bloqueio da autenticação no modo demo.
- Manual de primeiro preview em [`docs/VERCEL_PREVIEW.md`](docs/VERCEL_PREVIEW.md).

## Vercel

1. No painel Vercel, importe o repositório GitHub novo e conecte seu workspace.
2. Configure o **Root Directory** como `apps/web` (web app) e permita acesso a arquivos fora do root do monorepo.
3. Configure Install Command: `npm install` e Build Command: `cd ../.. && npm run build`. Se a Vercel já iniciar o comando no root do monorepo, use apenas `npm run build`. Verifique a pasta de trabalho nos logs do build.
4. Environments: `DATABASE_URL` (pooled), `BETTER_AUTH_SECRET` (32+ caracteres), `BETTER_AUTH_URL` (URL real do ambiente) e `NEXT_PUBLIC_APP_URL`.
5. Antes de habilitar login, crie e **commite** a migração inicial com `npm run db:migrate -- --name init` conectado a um PostgreSQL de desenvolvimento. Em banco gerenciado, aplique `npm run db:deploy` como etapa controlada de release, **nunca** dentro da requisição web.
6. O deploy de demonstração pode ser feito sem banco, mas a rota de autenticação vai retornar `503` até configurar as variáveis.

> **Atenção:** quando ocorrer a primeira implantação com usuários, considere revisão de segurança, limite de requisições, antiabuso e e-mails transacionais/verificação antes do cadastro público. O módulo de estimativa é ilustrativo e usa distância de linha reta.

## Endpoints de demonstração

- `GET /api/health`: status da aplicação.
- `POST /api/rides/estimate`: `{ "origin":{"lat":-24.0057,"lng":-46.4126}, "destination":{"lat":-24.0282,"lng":-46.4756}, "category":"economy" }`.
- `GET /api/food/restaurants`: catálogo fictício.
- `GET/POST /api/auth/*`: Better Auth, exige DB+segredo.

## Estrutura

```
apps/web/                 Next.js, páginas e APIs
packages/database/        Prisma schema, client e migrações
packages/rides/           Simulador e regras de corridas
packages/food/            Catálogo e cálculos de food
.github/workflows/ci.yml  Quality checks
```

## Próxima sprint

Implementar migrações geradas/validadas em banco real, perfis e onboarding, API de solicitação persistente, dispatch com concorrência atômica, geocodificação e mapas reais, testes E2E Playwright, rate limiting e monitoramento.
