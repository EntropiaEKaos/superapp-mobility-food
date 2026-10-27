# Sprint 06 — laboratório transacional de corridas

A Sprint 06 implementa **apenas um sandbox para administradores**, nunca um serviço comercial de mobilidade. `Ride`, `Vehicle` e usuários profissionais de produção não são modificados.

## Ativação controlada

- Por padrão `ENABLE_SANDBOX_DISPATCH` está ausente e o laboratório **não aceita nenhuma solicitação** (`503`).
- Para testes privados, configure `ENABLE_SANDBOX_DISPATCH=true` junto com `DATABASE_URL`, `BETTER_AUTH_SECRET` e URLs de autenticação em um banco **separado**.
- Acesse `/admin/sandbox-rides` com uma conta `ADMIN` provisionada fora do registro público.
- Nenhum endpoint do laboratório concede privilégios ao usuário; todas as mutações exigem sessão ADMIN e `Origin` correspondente.
- Não ligue esta flag em produção antes de uma revisão de segurança. A importação na Vercel foi adiada.

## Modelo de dados isolado

`SandboxDriver` (somente veículos fictícios), `SandboxRide` e `SandboxRideOffer` estão separados do domínio real. A migração `20261027160000_sandbox_ride_offers` é aditiva e verificada via diff em PostgreSQL 16.

## Ciclo demonstrativo

1. **Preparar veículos:** cria ou atualiza três fixtures fixas (não afeta motoristas reais).
2. **Criar corrida:** usa apenas pontos demonstrativos fixos da Praia Grande.
3. **Gerar ofertas:** classifica veículos fictícios próximos, ativos e livres e grava até duas ofertas com vencimento em 30 segundos.
4. **Aceitar:** transação `Serializable` faz compare-and-set da oferta, da corrida e da reserva do veículo. Em uma disputa, apenas uma transação confirma; a outra é revertida (`409`). As outras ofertas viram `DECLINED`.
5. **Concluir:** a corrida de laboratório passa a `COMPLETED`, liberando o veículo fictício; operações repetidas falham (`409`).
6. **Expirar:** a operação manual pode avançar o relógio virtual em até 120 segundos, marcando as ofertas vencidas como `EXPIRED`, sem aceitar ofertas antigas.
7. **Limpar laboratório:** apaga apenas registros `Sandbox*` (exige ADMIN e Origin válido).

## Testes de integração

O GitHub Actions inicia um Postgres efêmero, aplica migrações e roda `scripts/auth-db-smoke.mjs`, incluindo duas aceitações simultâneas por HTTP. O teste exige exatamente um `200` e um `409`, confirma o vencedor e a reserva do veículo, testa expiração e liberação e verifica que a tabela real `Ride` continua vazia. O smoke sem banco valida que os endpoints permanecem fechados (`503`).

## Ainda não implementado

Roteamento de ruas, ETA, GPS real, Redis/WebSockets, filas distribuídas, reconciliação, disponibilidade real, push, registro de passageiros, reservas em produção, corridas reais ou qualquer pagamento. O protótipo não simula passageiro em perigo, nem representa aprovação regulatória de transporte. Antes de ativar um serviço comercial: políticas de motorista, LGPD, seguros, regulamentação municipal e resiliência transacional.
