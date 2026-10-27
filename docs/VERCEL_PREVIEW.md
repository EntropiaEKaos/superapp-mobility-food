# Preview do SuperApp na Vercel (sem pagamentos)

## Objetivo do primeiro deploy

Publicar a home, simulador de corrida e catálogo/carrinho demonstrativo, **sem banco**, sem GPS em tempo real e sem processar compras ou viagens.

## Importação

1. No painel da Vercel, escolha **Add New → Project**.
2. Conecte o repositório público `EntropiaEKaos/superapp-mobility-food`.
3. Framework Preset: **Next.js**.
4. Root Directory: `apps/web`. Habilite o acesso a arquivos fora do Root Directory; os workspaces vivem em `packages/*`.
5. Node.js: **22.x**.
6. Install Command: `npm install`; Build Command: `cd ../.. && npm run build` (inspecione os logs para confirmar o diretório de trabalho; se já estiver na raiz, use `npm run build`).
7. Para o preview demonstrativo, não configure `DATABASE_URL` nem `BETTER_AUTH_SECRET`; as rotas de autenticação respondem 503 por projeto.
8. Publique um preview e teste `/`, `/rides`, `/food`, `/food/demo-bistro`, `/api/health` e `/api/food/restaurants`.

> ⚠️ Não configure segredos de produção nem tente habilitar cadastro até a migração inicial ter sido criada, revisada e aplicada em um banco real.

## Depois do primeiro deploy

- Fixar `package-lock.json` no repositório e substituir o install de CI por `npm ci`.
- Revisar schema Better Auth / Prisma 7 e versionar migrations, testando em PostgreSQL de desenvolvimento.
- Configurar segredos de desenvolvimento no painel da Vercel, nunca no GitHub.
- Implantar monitoramento, rate limiting, autorização por papel e testes antes de permitir solicitações reais.
- A navegação do carrinho é **somente local**. Não existe checkout ou endpoint de criação de pedido.

## Se a Vercel retornar 403

Um erro **403 Permission denied** ao criar o projeto exige revisar permissões da conta/equipe Vercel ou importar manualmente na equipe que efetivamente tem direito de criação. Não significa que o GitHub/CI falhou. Não reutilizar o projeto de outro produto como contorno.
