# Sprint 12 — Redis Pub/Sub como transporte opcional do laboratório

## Arquitetura

A Sprint 12 introduz uma **alternativa experimental** ao SSE baseado em conexões PostgreSQL por navegador. Em vez de manter um `LISTEN` para cada administrador, um **processo separado** executa `scripts/sandbox-redis-bridge.mjs`:

`Sandbox* table changes → PostgreSQL NOTIFY → bridge worker → Redis PUBLISH → Redis SUBSCRIBE → ADMIN SSE → dashboard`

O worker escuta `superapp_sandbox_changed`, disparado pelos triggers das tabelas fictícias existentes, e publica apenas a mensagem genérica `changed` no canal `superapp:sandbox:changed:v1`. Não publica documentos, GPS ou dados de usuários no Redis. Os dados completos continuam vindo de snapshots autenticados do PostgreSQL; não são enviados pelo broker. O stream envia um snapshot completo após cada conexão/reconexão e agrupa os avisos em 150 ms.

O serviço padrão **continua PostgreSQL LISTEN/NOTIFY (Sprint 11)**, com capacidade global 8. O Redis é ativado somente quando `SANDBOX_EVENT_TRANSPORT=redis` e `REDIS_URL` está definido, além de `ENABLE_SANDBOX_DISPATCH=true`, PostgreSQL e Better Auth.

## Ambiente de teste

Inicie PostgreSQL e Redis e aplique as migrações já versionadas. Para o transporte experimental, configure no servidor Next.js:

```bash
ENABLE_SANDBOX_DISPATCH=true
SANDBOX_EVENT_TRANSPORT=redis
REDIS_URL=redis://127.0.0.1:6379
```

Execute separadamente `npm run sandbox:bridge` como **processo de longa duração** (além do Next.js). Configure `DATABASE_URL` e `REDIS_URL` no worker. Um bridge parado provoca perda dos sinais incrementais; a reconexão SSE recupera o estado atual, mas não reproduz todos os eventos perdidos. Não use `redis.flushDb` em bancos compartilhados ou de produção (o CI só usa um Redis efêmero).

A rota e o frontend continuam `/api/admin/sandbox-rides/stream` e `/admin/sandbox-rides`. O código seleciona o transporte conforme a variável de ambiente.

## Quotas e segurança

- PostgreSQL tradicional: até **8 SSE simultâneos globais** e um por administrador, por advisory locks.
- Redis experimental: até **16 SSE simultâneos globais** e um por administrador, reservados por operações atômicas Redis Lua e leases com token UUID.
- Cada stream SSE dura até **45 segundos**; as leases Redis expiram em até **60 segundos** para limpar sessões interrompidas. A liberação manual confere o token para nunca remover leases de outra sessão.
- O servidor valida sessão Better Auth + papel ADMIN antes de conectar ao Redis.
- Redis indisponível no modo Redis retorna indisponibilidade/429 conforme o caso; o frontend mantém fallback GET de 6 s para a central. **Não abre silenciosamente streams PostgreSQL extras.**
- Cada stream Redis ainda usa sua própria conexão de assinatura Redis e outra conexão para gerenciar a lease; não é um gateway de distribuição para milhares de operadores.
- O contador `streamHealth` passa a indicar `transport: redis` e monitora as 16 vagas Redis. A leitura é aproximada e não representa conexão PostgreSQL ou usuários humanos.

## Testes CI

Novo job `PostgreSQL + Redis broker integration`: cria containers isolados Postgres16 + Redis7, inicia a ponte e Next.js, verifica acesso anônimo e cliente negado, notificação após inserção fictícia, reconexão com snapshot atual, rejeição de duplicação ADMIN, ocupação de todas as 16 vagas e readmissão após liberar uma vaga. Os jobs anteriores com o transporte padrão continuam rodando.

## Próxima etapa antes de escalar

Isto é somente uma **prova de conceito isolada**. Antes de operações reais: TLS e autenticação do Redis, monitoramento do worker, reconexão do worker ao PostgreSQL, leader election ou redundância controlada da ponte, filas duráveis/outbox quando perda de evento for inaceitável, limits por IP/sessão, gateway compartilhado por processo, segurança LGPD, controle de custos, testes de carga e compatibilidade do ambiente de deploy. Redis Pub/Sub é **não durável**; não garante entrega durante indisponibilidade.

A Vercel permanece adiada e nenhuma corrida, entrega ou pagamento real é ativado.
