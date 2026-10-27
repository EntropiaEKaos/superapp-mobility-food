# Sprint 05 — moderação de parceiros e ranking simulado

## Moderação com controle de acesso

- `/admin`: tela protegida exclusivamente para usuários com `User.role = ADMIN`, verificado no servidor e novamente na API.
- `GET /api/admin/partner-applications`: lista de inscrições limitada a 100, acessível só para administradores.
- `PATCH /api/admin/partner-applications`: decide entre `APPROVED` e `REJECTED`. Confere sessão, função administrativa, Origin e payload.
- A decisão é feita com `updateMany` condicionado a `status = PENDING` **e não ser a inscrição do próprio administrador**; impede sobrescrita por outro revisor.
- `reviewerId` e `reviewedAt` persistem a identidade da decisão e o horário, junto ao status.
- A aprovação significa apenas avaliação da inscrição; **não altera** `User.role`, não aprova veículos e não libera restaurante, corridas, entregas, repasses ou pagamentos.
- Não há endpoint público para tornar usuários ADMIN. Provisionamento de administradores fica fora da aplicação pública.

> Atenção: antes de colocar dados pessoais reais na plataforma, implementar retenção, trilha histórica imutável, revisão de documentos, proteção de dados, logs de acesso, rate limiting e conformidade com a LGPD.

## Algoritmo inicial de distribuição — somente simulação

O módulo puro `rankDemoDrivers`, em `packages/rides/src/dispatch.ts`, classifica um conjunto de **motoristas fictícios**, filtrando:

- aprovado, online e disponível;
- ponto geográfico válido;
- localização de até 60 segundos;
- raio de busca configurável (padrão 8 km);
- ordenação estável por distância em linha reta e ID.

A página `/rides/dispatch-demo` exibe o resultado. **Não gera corrida, não reserva motorista, não atribui corridas e não transmite localização.** A distância é geodésica, não roteamento viário nem ETA.

## Testes

O CI executa migrações em PostgreSQL temporário e testa em ambiente isolado:
- cliente comum bloqueado no painel e na API administrativa;
- decisão com origem falsificada bloqueada;
- aprovação auditada e segunda decisão rejeitada;
- proteção contra autoaprovação;
- aprovação não eleva a permissão do solicitante;
- algoritmos de filtragem e ordenação do ranking;
- rota demonstrativa renderizada, sem banco e sem efeitos externos.

## O que vem depois

Autorização multi-papel, verificação de documentos, ativação operacional pós-aprovação, motor de ofertas com reservas atômicas e expiração, registro de GPS com privacidade, geocodificação e simulação de corridas ponta a ponta. Nada disso é considerado pronto nesta sprint.
