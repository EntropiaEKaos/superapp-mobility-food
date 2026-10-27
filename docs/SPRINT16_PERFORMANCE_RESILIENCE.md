# Sprint 16 — Carga sintética, circuit breaker e prontidão de infraestrutura

## Escopo real desta entrega

Toda a implementação permanece restrita ao **laboratório administrativo de corridas fictícias**. A Sprint 16 fortalece o worker `scripts/sandbox-redis-bridge.mjs`, acrescenta telemetria no painel e amplia a CI com testes sintéticos. **Não** conecta motoristas, GPS, entregas ou pagamentos reais, e não implanta o aplicativo na Vercel.

## Circuit breaker do broker Redis

O novo módulo `scripts/lib/sandbox-broker-circuit.mjs` define um contador local e determinístico. Se o worker encontrar **3 falhas consecutivas** na publicação Redis, depois de persistir a tentativa, status e próximo prazo no PostgreSQL, registra `SANDBOX_BROKER_CIRCUIT_OPEN` e termina com código 1. Isso limita novas tentativas durante falhas repetidas, permitindo que o supervisor externo da Sprint 15 reinicie o worker com backoff. Uma publicação bem-sucedida zera o contador.

Esse limite é **por processo**, não um circuito distribuído para todos os workers. Os eventos afetados continuam `PENDING` ou `DEAD` conforme a política anterior, nunca são excluídos pelo circuit breaker. A lógica não garante que todo erro de transporte será detectado imediatamente, não protege contra processos travados por timeout de rede prolongado e não substitui proteções de infraestrutura.

## Métricas do painel administrativo

`/admin/sandbox-rides` agora indica:
- **P50 e P95 da latência de publicação**: percentis nearest-rank calculados sobre até **100** registros `PUBLISHED` mais recentes, usando `publishedAt - createdAt`; 
- **média** dessa mesma amostra;
- **publicados nos últimos 60 segundos**: contagem global dos registros cujo `publishedAt` está na janela;
- número de conexões atuais do worker, pendências e eventos esgotados (mantidos das sprints anteriores).

Não são SLAs comerciais nem métricas de entrega até o navegador. Também não medem latência de requisições Next.js, Redis Pub/Sub quando o browser está offline, disponibilidade de motoristas ou tempos de viagem. Os números podem ser alterados por carga do CI, cold start, backoff e agrupamento de lotes.

## Teste de carga sintética

`node scripts/outbox-benchmark-smoke.mjs` roda **somente com `CI=true`** e exige o PostgreSQL/Redis efêmero do GitHub Actions. Executa:
1. **240 INSERTs sintéticos** de registros `SandboxDriver` independentes, com pool PostgreSQL de até 12 conexões; cada INSERT confirma uma entrada na outbox;
2. sobe **4 workers** isolados e aguarda a publicação de todos os eventos;
3. verifica a quantidade, estado `PUBLISHED`, tentativas, ausência de duplicação no teste e isolamento da tabela comercial `Ride`;
4. emite métricas JSON: ingresso, escoamento, P50, P95 e vazão **apenas para essa execução de CI**.

O limite de P95 inferior a 30 segundos é uma proteção ampla contra regressões graves neste cenário efêmero, **não um SLA de produção**. Em ambiente lento ou sob disputa, valores do CI podem variar. Não foi feito benchmark de centenas de usuários simultâneos, GPS, viagens ou pagamentos.

`node scripts/broker-circuit-smoke.mjs` injeta falhas de Redis no modo CI, verifica abertura do circuito na terceira falha e prova que o evento durável continua disponível para publicação após a recuperação. Os testes anteriores de autenticação, concorrência, SSE, outbox, retenção e reinício permanecem ativos.

## Verificação read-only de infraestrutura

`node scripts/sandbox-infra-preflight.mjs` verifica presença de `DATABASE_URL` e `REDIS_URL`, conexão PostgreSQL, existência das tabelas `SandboxEventOutbox` e `SandboxOutboxRequeueAudit`, trigger de notificação e `PING` Redis. O script imprime apenas resultados sanitizados, sem mostrar URLs ou segredos. **Não modifica dados.** Não é atestado de segurança ou de prontidão comercial.

O GitHub Actions executa essa verificação no job integrado Redis/PostgreSQL antes dos testes do broker.

## Checklist necessário para uma implantação futura

- Escolher hospedagem para **worker contínuo e supervisor** fora de funções serverless com limites curtos; manter Redis/PostgreSQL próximos geograficamente e validar conexão direta de `LISTEN`.
- TLS para Redis e PostgreSQL, gestão de credenciais, menor privilégio possível e controle de rede.
- Monitoramento externo com alarmes de falha, latência e backlog; provisionar logs estruturados, tracing e limites de concorrência.
- Definir retenção, backup, recuperação de desastre, política LGPD e segurança de autenticação de administradores.
- Executar testes de carga realistas e avaliar Redis Streams/outbox com consumidores duráveis, se entrega fim-a-fim for exigida. Redis Pub/Sub permanece sem replay para clientes desconectados.
- O aplicativo permanece sem importação na **Vercel**, por decisão do projeto.

Para ativar o laboratório de forma isolada ainda são necessários Better Auth, PostgreSQL, Redis, a flag `ENABLE_SANDBOX_DISPATCH=true` e o transporte explicitamente em modo Redis. **Nunca ativar em produção sem análise adicional.**
