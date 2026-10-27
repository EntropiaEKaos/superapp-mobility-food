# Sprint 14 — Falhas controladas e retenção da outbox fictícia

A Sprint 14 trabalha exclusivamente com as notificações de **Sandbox**. Não processa pagamentos, pedidos ou corridas reais.

## Política de entrega

- O worker continua lendo no PostgreSQL lotes de até 25 linhas via `FOR UPDATE SKIP LOCKED`. Um evento só é `PUBLISHED` após o aviso Redis ser publicado e a transação de confirmação ser gravada.
- Uma falha de publicação é persistida com `lastErrorCode=REDIS_PUBLISH_FAILED` (sem expor strings sensíveis da conexão), `attempts` incrementado e `nextAttemptAt` calculado com backoff exponencial de 2, 4, 8, 16 e até 60 segundos.
- Após **5 tentativas malsucedidas**, o registro torna-se `DEAD`, não sendo reenviado automaticamente. É necessário diagnóstico e intervenção operacional para decidir se deve ser republicado.
- Se o Redis desconectar, o worker encerra e espera reinício por supervisor externo. A fila não é descartada. Em qualquer interrupção entre Redis PUBLISH e confirmação no PostgreSQL, o aviso pode ser duplicado; a entrega continua **at least once** ao broker, não exactly once.
- O comando de limpeza não reprocessa nem apaga eventos `DEAD` ou `PENDING`. Não há endpoint público para reprocessar eventos.

## Operação e retenção

Execute `node scripts/sandbox-outbox-prune.mjs --days=7` para simular a limpeza de eventos **PUBLISHED** com mais de 7 dias. Nada é apagado sem `--apply`.

Para aplicar, execute `node scripts/sandbox-outbox-prune.mjs --days=7 --apply` somente no ambiente de laboratório revisado. Cada execução remove no máximo 500 registros publicados elegíveis; para um backlog antigo, execute novamente após inspeção. O período aceito é de 1 a 365 dias e consultas são parametrizadas.

A rotina não é agendada por padrão. Não execute em banco comercial sem política de retenção e plano de backup.

## Observabilidade

A central administrativa mostra eventos pendentes, publicados, em nova tentativa e esgotados (`DEAD`), com alerta de pendência antiga ou necessidade de revisão. As métricas são instantâneos do banco PostgreSQL, não contagem de entregas recebidas em navegadores.

## Testes em GitHub Actions

Além das suites anteriores, o job PostgreSQL + Redis executa uma prova CI isolada que:
1. Injeta uma falha transitória no publisher **apenas quando `CI=true`** e confirma tentativa registrada, espera e sucesso posterior.
2. Injeta falha na quinta tentativa e verifica a transição para `DEAD`.
3. Demonstra `dry-run` e limpeza limitada que preserva `DEAD`.
4. Cria 60 mudanças fictícias e valida escoamento usando dois workers em paralelo.
5. Mantém os testes de queda/reinício, rollback, SSE, auth, migrações e build.

## Limites

A rotina não garante ordenação global de notificações; SKIP LOCKED permite execução concorrente, e os clientes SSE recebem snapshots atuais. Redis Pub/Sub continua não durável para navegadores desconectados. Um `DEAD` exige diagnóstico, não equivale a uma tentativa de negócio não executada; nem mesmo uma notificação publicada comprova que algum cliente a recebeu. Ainda faltam supervisor de worker, tracing e métricas externas, backups, política LGPD, rate limiting de requisições e teste de carga real antes da produção. A Vercel permanece adiada.
