# Sprint 10 — Eventos do PostgreSQL + SSE com reconexão

## Arquitetura

O monitoramento ADMIN do laboratório deixa de depender exclusivamente de GET a cada 6 segundos. Uma nova rota **Server-Sent Events (SSE)** é assinada em `/api/admin/sandbox-rides/stream`. O servidor escuta o canal `superapp_sandbox_changed` via `LISTEN` no PostgreSQL 16.

Triggers *apenas nas tabelas fictícias* `SandboxRide`, `SandboxRideOffer`, `SandboxDriver` e `SandboxRideEvent` fazem `NOTIFY` quando uma operação de banco é confirmada. O payload da notificação é apenas `changed`: não contém documentos, endereços pessoais, posições reais ou qualquer dado de usuário.

Cada nova conexão envia um snapshot completo dos últimos 20 registros e das métricas globais, garantindo **reconexão sem perda do estado atual** (mas não promete replay de todos os eventos históricos). Em novos avisos, notificações são agrupadas por 150 ms, evitando excesso de consultas durante transações com várias alterações. Há heartbeat por comentário SSE a cada 12 segundos, instrução de reconexão em 3 segundos, e **duração máxima de 45 segundos por conexão**. O cliente reabre a conexão automaticamente.

## Permissões e resiliência

- `ENABLE_SANDBOX_DISPATCH` continua **false** por padrão; exige configuração de PostgreSQL e Better Auth.
- A rota valida **sessão autenticada e role ADMIN** antes de adquirir conexão `LISTEN`.
- Cache e buffering de proxies desativados. A resposta só inclui dados do laboratório, iguais aos permitidos no GET protegido.
- Cada conexão mantém **uma conexão PostgreSQL dedicada** por até 45 segundos, liberada em cancelamento, erro ou encerramento.
- A revogação do papel administrativo passa a valer na próxima conexão, em no máximo 45 segundos na operação normal; ainda não existe revogação instantânea de streams já abertos.
- O navegador **fecha o stream** ao ocultar a aba, pausar ou iniciar uma mutação.
- Em duas falhas consecutivas da SSE, entra em fallback GET de 6 segundos, com backoff até 30 segundos se houver falha de rede. A cada 60 segundos tenta retornar ao SSE.
- O frontend nunca escreve no banco a partir de uma atualização recebida. As mutações continuam restritas às APIs administrativas transacionais.

## Limites importantes

Esse é um mecanismo de eventos para o **laboratório privado** e não uma arquitetura pronta para escala pública. A estratégia de uma conexão PostgreSQL por operador precisa de limites por conta/sessão, pool/proxy apropriado, métricas de conexões e possivelmente um broker de eventos antes de centenas de usuários. O streaming contínuo pode ser incompatível com limites de alguns ambientes serverless, inclusive configurações de hospedagem da Vercel.

A conexão pode perder notificações enquanto desconectada, mas sempre recebe um snapshot completo após reconectar. O histórico auditável de `SandboxRideEvent` continua no PostgreSQL.

## CI

O teste PostgreSQL 16 faz:
- resposta `503` no modo demo sem credenciais;
- `401` para anônimo e `403` para cliente;
- handshake SSE protegido para ADMIN, `Content-Type: text/event-stream`;
- snapshot inicial, inserção de corrida fictícia e recebimento do novo snapshot por NOTIFY sem polling;
- reconexão trazendo o estado atual;
- regressão das migrações, estados de viagem, concorrência, ofertas e histórico.

A Vercel continua adiada conforme solicitado.
