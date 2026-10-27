# Sprint 15 — Supervisão e recuperação auditada da outbox

Esta sprint modifica **apenas o laboratório administrativo de eventos fictícios**. Nenhuma corrida real, entrega, GPS, cobrança ou pagamento fica ativado.

## Supervisor independente

`node scripts/sandbox-bridge-supervisor.mjs` inicia o worker da ponte Redis como subprocesso separado, monitora saídas inesperadas e reinicia com espera exponencial (500 ms até 15 s). Após cinco reinícios sucessivos, encerra com erro, solicitando intervenção do orquestrador. Se o processo ficar estável por um minuto, o contador de falhas é reiniciado. SIGTERM/SIGINT encaminha desligamento ao filho.

**Não** execute o supervisor dentro de uma API Next.js, função serverless ou processo que já tenha outro supervisor externo sobre o mesmo subprocesso. Um gerenciador de processos real ainda deve iniciar e supervisionar o script, capturar logs e alertar quando este sair. Testes usam um worker substituto apenas com `CI=true`.

## Diagnóstico operacional

Em `/admin/sandbox-rides`, o painel passa a mostrar:
- número aproximado de conexões PostgreSQL do worker (`application_name=superapp-sandbox-outbox-worker`);
- média de atraso de publicação, calculada entre `createdAt` e `publishedAt` numa amostra de até 50 avisos publicados;
- até cinco avisos `DEAD` com contagem de tentativas e código de falha sanitizado;
- totais de pendentes, publicados, em retry e esgotados já existentes.

A contagem de conexões não é um sinal de saúde suficiente; o worker pode estar conectado mas sem progresso. A média de atraso é amostral e não representa percentis ou SLA.

## Reprocessamento manual auditado

`POST /api/admin/sandbox-outbox/requeue` recebe `{ "id": "123", "confirmation": "REQUEUE" }` e exige:
- feature flag `ENABLE_SANDBOX_DISPATCH=true`;
- sessão Better Auth e papel `ADMIN` verificado no banco;
- `Origin` igual ao domínio configurado e `Content-Type: application/json`;
- ID positivo e confirmação exata;
- status atual `DEAD` — nunca reabre `PUBLISHED` ou `PENDING`.

Dentro de uma transação serializável, um `updateMany` condicional restaura o evento para `PENDING`, limpa o código de erro e reinicia o contador; na mesma transação cria `SandboxOutboxRequeueAudit` com o ID e o ator responsável. Repetir a solicitação sem um novo erro retorna HTTP 409 e não duplica a auditoria. O painel exige dois passos, incluindo digitar a confirmação.

**Reabrir um aviso não significa reenviar uma corrida ou executar qualquer ação comercial.** O evento é apenas um sinal genérico para atualizar snapshots SSE.

## Testes no GitHub Actions

- Supervisor fictício cai duas vezes, recupera na terceira execução e encerra ao receber SIGTERM.
- Banco temporário valida 401 anônimo, 403 cliente, 403 origem falsificada, 422 confirmação inválida, 200 reprocessamento, 409 repetição, alteração transacional e registro correto de auditoria.
- Continuam as suites PostgreSQL+Auth, Redis+SSE, retry/backoff, dead-letter, retenção e concorrência.

## Limites e próximo passo

Este supervisor ainda não garante alta disponibilidade, liderança distribuída, backoff com jitter, alertas externos, métricas Prometheus nem recuperação automática se o host inteiro cair. Redis Pub/Sub segue sem replay durável para navegadores desconectados. Antes de produção são necessários monitoramento externo, orquestração, gestão de segredos, quotas, provas de carga maiores, segurança de operação e políticas de retenção. Deploy Vercel adiado.
