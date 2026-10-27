# Sprint 17 — Monitoramento externo e homologação sem deploy

## Entrega realizada

A Sprint 17 adiciona uma verificação de prontidão **do laboratório**, autenticada por token de máquina e separada do acesso de administradores. A rota `GET /api/ops/sandbox-health` só está ativa quando `ENABLE_SANDBOX_DISPATCH=true` e `SANDBOX_MONITOR_TOKEN` tem ao menos 32 caracteres. Sem ambos, retorna 503. Token ausente ou errado retorna 401, sem métricas internas.

O token é enviado no cabeçalho `Authorization: Bearer ...` e comparado por digest SHA-256 em tempo constante, com resposta `Cache-Control: private, no-store`. Nunca coloque o token em URLs, cookies, commits, prints ou logs compartilhados. O acesso de administradores ao painel continua protegido por Better Auth.

### Condições verificadas

| Código | Quando é emitido |
| --- | --- |
| `OUTBOX_DELAYED` | Há um evento ainda PENDING há mais de 15 s |
| `OUTBOX_DEAD` | Há eventos DEAD que precisam de revisão |
| `WORKER_MISSING` | Transporte Redis selecionado e não há conexão PostgreSQL identificada como worker |
| `REDIS_UNREACHABLE` | Transporte Redis selecionado e o Redis não respondeu ao PING |
| `DEPENDENCY_UNAVAILABLE` | A consulta da base ou configuração necessária falhou |

O endpoint retorna 200 com `status: healthy` e `reasons: []` quando todas as verificações passam; retorna 503 quando alguma falha é encontrada. São **sinais de infraestrutura e fila**, não prova de saúde dos motoristas, disponibilidade de entrega ou de pagamentos. O worker pode estar conectado sem fazer progresso; a idade da outbox oferece um segundo sinal.

O modo PostgreSQL não exige Redis nem worker de ponte. O modo Redis precisa de ambos.

## Verificação por serviço externo

O arquivo `scripts/sandbox-monitor-check.mjs` realiza uma consulta única; é apropriado para cron, monitor HTTP com suporte a cabeçalhos, ou orquestrador externo. Exige:
- `SANDBOX_MONITOR_URL`, URL HTTPS do endpoint; HTTP apenas para localhost/loopback;
- `SANDBOX_MONITOR_TOKEN`, mesmo segredo do servidor;
- opcional `SANDBOX_ALERT_WEBHOOK_URL`, endpoint HTTPS para receber um JSON **sem tokens** em caso de falha.

Execute `node scripts/sandbox-monitor-check.mjs`. Sai com código **0** quando saudável, **1** quando falha e **2** em configuração inválida. O webhook opcional recebe apenas o componente, status, códigos de motivo, status HTTP e horário da consulta. Nenhuma coordenada, nome de usuário, ID de corrida ou segredo é enviado. O verificador não possui agendamento ou deduplicação própria: **alguém ainda precisa configurar um agendador externo e política anti-ruído** para alertas contínuos. O GitHub Actions valida isso apenas em banco efêmero, sem enviar alertas comerciais.

## Preparação de um ambiente de homologação

Modelo seguro: `deploy/staging/.env.example`. Ele contém apenas campos em branco e **ENABLE_SANDBOX_DISPATCH=false**, para impedir ativação acidental.

Sequência planejada — **não executada nem implantada por esta sprint**:

1. Provisionar um PostgreSQL e Redis exclusivos de homologação, com TLS, credenciais únicas, backup e regras de rede fechadas.
2. Configurar Better Auth, variáveis de ambiente e segredos através do gerenciador de segredos do provedor; manter `ENABLE_SANDBOX_DISPATCH=false` até validar o acesso.
3. Executar as migrações versionadas e `node scripts/sandbox-infra-preflight.mjs` numa rede segura de homologação.
4. Configurar worker Redis supervisionado como processo de longa duração **se** esse transporte for escolhido; não executá-lo dentro de função serverless.
5. Habilitar **somente o sandbox isolado** após revisar as permissões ADMIN e confirmar que a tabela comercial `Ride` continua intocada.
6. Configurar um monitor externo para `/api/ops/sandbox-health` por HTTPS, com segredo forte e alertas em uma rota privada. Testar falha controlada e recuperação.
7. Realizar testes E2E, backup/restauração, tráfego gradual de homologação e revisão de custos e LGPD antes de considerar operação real.

### Verificações da CI

Os jobs PostgreSQL e Redis executam `scripts/sandbox-monitor-smoke.mjs`, que inicia uma aplicação isolada, verifica HTTP 401 sem token ou com segredo incorreto, saúde 200, degradação HTTP 503 em `DEAD` e `PENDING` antigo, execução do verificador externo, recebimento de alerta saneado e retorno à saúde após limpar os registros fictícios. O job Redis testa adicionalmente a ausência e a presença do worker. O smoke de demonstração confirma que o endpoint permanece fechado por padrão.

## Limitações

Este monitor não prova disponibilidade de produção, nem oferece tracing distribuído, política de SLO, alta disponibilidade de worker ou notificações automáticas sem serviço externo. A Vercel **continua adiada a pedido do proprietário**; esta entrega não cria infraestrutura e não habilita corridas, pedidos nem cobranças reais.
