# Sprint 18 — Homologação automatizada, papéis e relatório de qualidade

## O que foi implementado

Criamos uma suíte **ponta a ponta em HTTP + PostgreSQL**, executada em um **job isolado do GitHub Actions**, sem usar a base de produção nem a base dos outros jobs. O teste chama as rotas reais da aplicação Next.js compilada, autentica usuários fictícios com Better Auth e verifica efeitos transacionais diretamente no banco temporário.

O script é `scripts/homologation-journey.mjs`. Ele se recusa a executar quando `CI` não é `true` ou quando `DATABASE_URL` não aponta para uma base de teste denominada `superapp_ci`. **Não é um script para rodar em bancos de clientes.**

## Cobertura do fluxo

1. Inicialização da aplicação e saúde do serviço.
2. Catálogo e restaurante ilustrativos; não há pedido real.
3. Estimativa ilustrativa de corrida, incluindo rejeição de coordenadas inválidas.
4. Cadastro de duas contas fictícias: cliente e futuro administrador; ambas começam com o papel `CUSTOMER`.
5. Solicitação de parceria pelo cliente, prevenção de inscrição duplicada e proibição de decisão administrativa pelo solicitante.
6. Promoção do usuário administrativo **apenas no banco efêmero do CI**, seguida de aprovação auditada e bloqueio de segunda decisão; o cliente permanece `CUSTOMER`.
7. Bloqueio de operações para clientes e de mutações com `Origin` não confiável.
8. Criação de veículos e corrida simulada; duas ofertas concorrentes, com apenas um aceite vencedor.
9. Dez posições simuladas: cinco de aproximação, cinco de percurso, depois conclusão.
10. Verificação de **16 eventos sequenciais**, histórico imutável, liberação do veículo fictício e total zero de `Ride` comercial.
11. Rejeição de aceite após expiração e cancelamento de outra corrida.
12. Conferência do painel ADMIN e leitura que não cria novos eventos.

O fluxo de parceiro aprovado **não concede automaticamente permissão de motorista**; o laboratório também não aciona um motorista real. Essas garantias são verificadas.

## Relatório de qualidade

Cada execução gera:
- `artifacts/homologation/report.json`: status final, identificação não sensível do run, casos, tempo de cada etapa e quantidade de eventos verificados.
- `artifacts/homologation/report.md`: tabela legível com PASS/FAIL e duração de cada etapa.

O workflow armazena esses arquivos como artifact `sprint18-homologation-qa` usando `actions/upload-artifact@v4`, inclusive quando o script falhar. A retenção configurada é de 14 dias.

**Não são incluídos** cookies, tokens, e-mails dos usuários fictícios, IDs de hóspedes/motoristas reais ou dados de pagamento nos relatórios. O console do CI pode conter mensagens técnicas de falha; revise permissões e retenção do repositório.

## O que é e o que não é homologação nesta sprint

São **testes de integração HTTP/SSR** sobre o sistema compilado em banco efêmero. Não são testes com navegador real de clique, viewport, teclado, acessibilidade ou responsividade, nem teste de experiência do usuário, nem medição de SLA comercial. A validação visual e testes em browsers reais deverão ocorrer antes de disponibilizar o produto.

Este PR **não cria um endereço público de staging**, não conecta um banco de homologação externo, não programa implantação e não importa nada na Vercel. O arquivo `deploy/staging/.env.example` criado na Sprint 17 continua sendo a referência de configuração segura com o laboratório desligado por padrão.

## CI e critérios de aceitação

Os três jobs existentes continuam executando lint, typecheck, unit, build, autenticação PostgreSQL, broker Redis, resiliência e benchmark. O novo quarto job `Homologation — customer/admin end-to-end + QA report` precisa concluir com sucesso, e o artifact precisa conter o relatório.

Se surgir uma falha, o PR não deve ser integrado até que a regressão seja corrigida e o CI volte a ficar verde.

## Próximos passos

Para uma homologação realmente usável por avaliadores: provisionar infraestrutura isolada, configurar acessos internos, validar navegador (Playwright ou equivalente), critérios de acessibilidade, screenshots de regressão, backup/restauração, LGPD e segurança antes de permitir dados reais. Vercel continua adiada.
