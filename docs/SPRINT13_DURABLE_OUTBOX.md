# Sprint 13 — Outbox transacional e recuperação do worker Redis

## Por que precisamos desta etapa

A ponte da Sprint 12 dependia de um aviso `LISTEN/NOTIFY` entregue enquanto o worker estivesse online. Uma alteração confirmada durante uma interrupção podia deixar de gerar publicação Redis. Agora cada alteração de tabela fictícia escreve um registro **durável e pendente** em `SandboxEventOutbox` na mesma transação PostgreSQL, antes de emitir o aviso rápido.

`SandboxRide/SandboxDriver/SandboxRideOffer/SandboxRideEvent → trigger → SandboxEventOutbox(PENDING) → worker → Redis Pub/Sub → SSE`.

Os triggers registram somente `sourceTable`, `operation`, status e horários: **não duplicam dados pessoais ou localizações** na fila. No transporte PostgreSQL anterior, `pg_notify` segue funcionando como antes.

## Worker resiliente

O processo `npm run sandbox:bridge` mantém uma conexão LISTEN e uma segunda conexão de processamento. No início e a cada 1,5 segundo, verifica o backlog, mesmo que avisos tenham sido perdidos.

- Consulta lotes de até 25 registros usando `SELECT ... FOR UPDATE SKIP LOCKED` em transação, podendo haver mais de um worker em execução sem que ambos reivindiquem o mesmo lote simultaneamente.
- Publica o aviso genérico `changed` no canal Redis.
- **Somente depois da publicação** marca o lote como `PUBLISHED`, com horário e contador de tentativas.
- Se ocorrer falha antes do commit, a transação é revertida e os registros continuam `PENDING` para nova tentativa após reinício.
- Um erro de Redis/PG encerra o worker para que o supervisor externo o reinicie. **Ainda não há supervisor gerenciado integrado**, reconexão interna automática ou fila morta.
- Não inclui agendamento de retenção/expurgo. Os registros da outbox crescerão sem limite se não for configurada uma política posterior.

**Entrega pelo worker ao Redis é pelo menos uma vez, não exatamente uma vez.** Se o processo publicar no Redis e cair antes de confirmar `PUBLISHED`, o aviso pode ser repetido. Os clientes SSE sempre consultam snapshots completos e tratam notificações repetidas com segurança.

Redis Pub/Sub **continua não durável**: se o navegador estiver desconectado, não há replay automático dos avisos; ao reconectar recebe o estado atual do PostgreSQL. O modelo não substitui uma outbox de negócio, uma fila de pagamentos ou auditoria de cobranças.

## Diagnóstico no painel

A central `/admin/sandbox-rides` apresenta:

- contagem global de `PENDING` e `PUBLISHED` no PostgreSQL;
- idade, em segundos, do registro pendente mais antigo;
- aviso se houver pendência com mais de 15 segundos.

Os indicadores são somente leitura. Não executam correções silenciosas nem exibem dados comerciais.

## Verificação GitHub Actions

O job Redis/PostgreSQL verifica, além da Sprint 12:

1. Uma alteração na tabela fictícia produz um registro `PENDING` na mesma transação.
2. Um `ROLLBACK` remove tanto a alteração quanto o registro de notificação.
3. O worker publica a notificação e confirma o status `PUBLISHED`.
4. Com o worker parado, outra alteração persiste como `PENDING`.
5. Um worker reiniciado encontra a pendência por varredura e a republica.
6. A tabela comercial `Ride` permanece intocada.

## Antes de qualquer produção

Implementar supervisão e reinício automático do worker, métricas de tentativas e duração, retenção, dead-letter/retries com limites, limpeza de eventos antigos, publicação durável onde necessário, segurança Redis, recuperação de conexões, liderança distribuída conforme demanda e testes de carga. O laboratório permanece atrás de `ENABLE_SANDBOX_DISPATCH` e autenticação ADMIN. Vercel adiada a pedido do proprietário.
