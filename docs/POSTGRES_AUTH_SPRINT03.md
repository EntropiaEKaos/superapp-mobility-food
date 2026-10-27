# Sprint 03 — PostgreSQL e autenticação persistente

## O que mudou

A migração inicial está versionada em `packages/database/prisma/migrations/20261027093000_initial/migration.sql`. O CI agora inicializa **PostgreSQL 16 isolado**, aplica `prisma migrate deploy`, verifica que o banco está alinhado ao schema do Prisma e testa cadastro, login via cookie, consulta de sessão e restrição de acesso a `/admin`.

## Implantação segura

1. Use um banco PostgreSQL **de desenvolvimento, vazio**. A migração inicial não foi feita para rodar sobre tabelas existentes.
2. Configure `DATABASE_URL` apenas em ambientes e sistemas de segredos; nunca no GitHub.
3. Execute `npm install` e `npm run db:generate` após o checkout.
4. Execute `npm run db:deploy` uma vez no processo de implantação controlada, antes de disponibilizar cadastro.
5. Defina `BETTER_AUTH_SECRET` exclusivo e aleatório (32+ caracteres), `BETTER_AUTH_URL` e `NEXT_PUBLIC_APP_URL` para o domínio correto.
6. Execute `npm run build`, teste o cadastro e confirme que usuários novos permanecem com papel `CUSTOMER`.
7. Revise autenticação por e-mail, recuperação de acesso, limites de requisições, auditoria e política de dados **antes** de lançar cadastro aberto ao público.

**Não execute `prisma migrate dev` ou `prisma db push` diretamente em produção.** Não armazene documentos ou dados de motoristas antes de definir práticas de proteção de dados.

## Verificação CI

- Job `validate`: lint, TypeScript, testes unitários, build e demo smoke.
- Job `postgres-integration`: banco efêmero e credenciais fictícias, migrações, comparação com schema e smoke Better Auth.
- Não há motorista ativo, corrida em andamento, estabelecimento em operação ou fluxo de pagamento real.

## Limitação de deploy

A Vercel ainda precisa que o repositório seja importado pela conta com permissão de criar projetos. O deploy demonstrativo continua independente do banco; a autenticação só deve ser habilitada depois de configurar o PostgreSQL e as migrações com sucesso.
