# Sprint 11 — orçamento de conexões SSE e diagnóstico operacional

## O problema resolvido

Na Sprint 10 cada navegador conectado abria uma sessão `LISTEN` dedicada ao PostgreSQL. Em várias instâncias Next.js, contadores locais de memória não conseguiriam limitar o consumo global de conexões.

A Sprint 11 usa **advisory locks de sessão do próprio PostgreSQL**, em namespaces separados, para realizar a admissão de conexões:

- **8 conexões SSE no máximo por banco**, compartilhadas entre instâncias da aplicação;
- **1 transmissão por conta ADMIN** (outra aba do mesmo administrador recebe HTTP 429);
- abertura e reserva de vaga são atômicas; a nona tentativa recebe HTTP `429` + `Retry-After: 30`;
- quando o cliente encerra a sessão SSE, fecha-se a conexão dedicada e o PostgreSQL libera automaticamente as travas;
- as conexões duram no máximo 45 segundos por ciclo, forçando reconexão e revalidação de permissão.

O stream segue restrito à flag `ENABLE_SANDBOX_DISPATCH=true` e à autenticação Better Auth com papel `ADMIN` verificado no banco, sem expor dados reais.

## Monitoramento

O snapshot operacional passa a incluir `streamHealth`:

- `activeConnections`: sessões atualmente visíveis ao PostgreSQL com `application_name=superapp-sandbox-sse`;
- `capacity`: orçamento global de 8 conexões;
- `availableSlots` e `utilizationPercent`: vagas restantes e utilização.

A central `/admin/sandbox-rides` mostra um medidor de ocupação e explica o fallback. A contagem é um instantâneo aproximado: durante a abertura ou liberação de uma conexão pode existir diferença momentânea entre sessões conectadas e vagas já concedidas.

O navegador permanece capaz de recorrer a GET a cada 6 segundos (com backoff em erros), não mantendo conexões SSE extras quando a capacidade foi atingida.

## Testes de concorrência

No PostgreSQL 16 isolado do CI:
1. Uma conta ADMIN abre um stream, e uma segunda conexão da **mesma conta** recebe `429 user_busy`.
2. Uma segunda sessão autenticada, promovida a ADMIN exclusivamente no banco efêmero do CI, consegue transmitir em paralelo.
3. O teste encerra essas duas conexões e simula **oito processos/instâncias externos** detendo locks de sessão do PostgreSQL. Uma nova solicitação ADMIN recebe `429 capacity_reached`, sem obter conexão SSE.
4. Uma instância externa libera sua vaga; uma conexão HTTP autenticada a utiliza sem conflito.
5. Os indicadores mostram oito conexões ativas, zero vagas restantes, e o painel administrativo renderiza o medidor.

Os clientes extras simulam **conexões de banco concorrentes**, não oito identidades humanas logadas. Os testes não desativam nem contornam o limite antiabuso do cadastro público.

## Limitações e próxima infraestrutura

Advisory locks exigem sessões PostgreSQL estáveis. **PgBouncer em transaction pooling não é compatível** com `LISTEN/NOTIFY` ou travas de sessão; o stream deve usar conexão direta ou pool em modo session.

Esta abordagem é específica do laboratório, não serviço de grande escala. Não limita as conexões Prisma usadas por requisições GET nem controla todos os consumidores do banco. Para operação comercial ou centenas de operadores, migrar para um broker como Redis Pub/Sub ou filas de eventos com gateway SSE/WebSocket, identidade persistente, quotas por tenant/IP, testes de carga, observabilidade e políticas de revogação imediata.

O histórico de corridas, pagamentos, motoristas reais e o deploy da Vercel permanecem fora deste escopo.
