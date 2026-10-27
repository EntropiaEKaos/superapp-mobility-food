# Sprint 07 — Estados da viagem e histórico auditável (somente sandbox)

O laboratório de corridas foi ampliado com uma **máquina de estados explícita** e um histórico persistente, ordenado e append-only em `SandboxRideEvent`. Tudo permanece restrito a administradores, com `ENABLE_SANDBOX_DISPATCH=true`, e usa apenas veículos e pontos geográficos fictícios.

## Fluxo da viagem

`REQUESTED → OFFERED → ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED`.

- `REQUESTED`: corrida fictícia criada, evento `CREATED`.
- `OFFERED`: até duas ofertas com validade de 30 segundos, evento `OFFERED`.
- `ACCEPTED`: uma única oferta vencedora e reserva exclusiva do veículo, evento `ACCEPTED`.
- `ARRIVING`: veículo fictício se desloca ao ponto de embarque em cinco passos.
- `IN_PROGRESS`: embarque simulado concluído; outros cinco passos até o destino.
- `COMPLETED`: só após o quinto passo da viagem; libera o veículo e registra conclusão.
- `CANCELED`: cancelamento possível antes da viagem começar, liberando a reserva fictícia; rejeitado depois.
- `EXPIRED`: vence o prazo das ofertas sem aceite; não pode avançar.

## Concorrência e histórico

As transições e atualizações de posição executam transações serializáveis com comparação da versão anterior (`version`). Cada operação confirmada incrementa a versão e insere `SandboxRideEvent` com `sequence` único por corrida na mesma transação. Se duas requisições concorrerem, a perdedora não pode gravar um segundo evento com a mesma sequência.

O histórico inclui tipo, status anterior/posterior, instante e coordenadas **fictícias** dos passos simulados. O endpoint de listagem usa a mesma proteção de administrador da Sprint 06. Ainda não há rastreamento de dispositivos, WebSockets, GPS ou acesso de passageiros.

## Testes automáticos

O smoke com PostgreSQL 16 valida: aceite único, proibição de pular etapas, concorrência em atualização de posição, cinco marcos para embarque e cinco para viagem, conclusão e liberação, imutabilidade de viagem finalizada, cancelamento, expiração, sequência contínua dos eventos e isolamento da tabela real `Ride`.

## Limites

Não há geração de pagamentos, ETA, GPS, dados de motoristas reais, histórico imutável à prova de administradores do banco ou operação comercial. Regras de privacidade, retenção e segurança operacional precisarão de uma etapa própria antes de qualquer oferta real.
