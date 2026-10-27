# Sprint 08 — Central Visual de Operações (somente laboratório)

## Resumo

A rota administrativa `/admin/sandbox-rides` passa a apresentar uma central de observabilidade para o **sandbox de corridas**. O design usa indicadores em destaque, distribuição por estados, lista de eventos recentes, diagnóstico de integridade e filtro dos últimos 20 registros. Nenhuma funcionalidade comercial foi ativada.

## O que os números significam

Os **totais globais** são consultas agregadas às tabelas isoladas `Sandbox*` do PostgreSQL: corridas por status, veículos, ofertas pendentes e vencidas, eventos persistidos. O contador de veículos livres exige `active=true`, `busy=false` e localização fictícia recente (até 60 segundos).

A lista de corridas mostra **no máximo 20 registros mais recentes**. O filtro de estado e a busca textual atuam apenas nessa lista carregada; não fazem pesquisa global no banco. O diagnóstico de integridade também analisa a amostra recente, e não pode ser apresentado como auditoria de todo o banco.

A tela exibe a hora da consulta e disponibiliza **Atualizar indicadores** para nova leitura. Não há websockets ou polling em tempo real nesta etapa.

## Diagnósticos de leitura (nenhuma alteração automática)

- `OVERDUE_OFFER`: corrida `OFFERED` com oferta ainda `PENDING` vencida;
- `MISSING_WINNER`: corrida ativa sem veículo fictício associado;
- `EVENT_GAP`: sequência de eventos ou versão de corrida inconsistente;
- `STUCK_RIDE`: corrida fictícia ativa há mais de 30 minutos.

O alerta global de ofertas vencidas considera todo o banco, enquanto os diagnósticos com ID cobrem apenas as 20 últimas corridas.

**Nenhum diagnóstico executa correções automaticamente.** As operações manuais seguem usando os endpoints autenticados e transações `Serializable` implementados nas sprints anteriores.

## Controles de segurança

- `ENABLE_SANDBOX_DISPATCH` continua desativado por padrão.
- Sessão `ADMIN` validada em servidor e API; mutações exigem `Origin` confiável.
- `GET /api/admin/sandbox-rides` retorna somente dados fictícios, com `Cache-Control: private, no-store`.
- Não há GPS real, pagamentos, motoristas ou passageiros reais, nem dependência de deploy Vercel.

## Testes

O GitHub Actions (PostgreSQL 16 efêmero) valida contadores globais versus SQL, evento mais recente, painel renderizado para ADMIN, oferta forçadamente vencida sinalizada em diagnóstico, desaparecimento do alerta após expiração, acesso de clientes bloqueado e o fluxo de concorrência das sprints anteriores.
