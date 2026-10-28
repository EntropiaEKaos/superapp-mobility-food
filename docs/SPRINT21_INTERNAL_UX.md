# Sprint 21 — Mobilidade e delivery: interfaces internas

Esta evolução reorganiza as telas de corridas, restaurantes e cardápio e amplia ações do laboratório sem ativar operações comerciais.

## Entregas
- Estimador de corrida com inversão de origem/destino, indicação acessível da categoria selecionada e resultado anunciado como status; mapa explicitamente conceitual.
- Catálogo com melhor hierarquia, cards e chamadas para o cardápio.
- Restaurante com cabeçalho destacado e resumo de cardápio demonstrativo.
- Carrinho com badge de quantidade, subtotal atualizado acessível, botão para limpar e aviso de que a finalização está indisponível.
- CSS responsivo para desktop e celular, respeitando a navegação inferior da Sprint 20.
- Playwright no Chromium exercita inversão de rota, cotação, adicionar item e limpar o carrinho nos dois viewports, além das verificações anteriores.

## Segurança e operação
Nenhuma API de pedido ou pagamento foi criada, nenhuma corrida real é solicitada e o carrinho continua exclusivamente local ao navegador. Banco, Better Auth e Redis não foram alterados.

## Validação
Cinco jobs do GitHub Actions: lint/build/smoke, PostgreSQL/Auth, PostgreSQL/Redis, jornada de homologação HTTP e Chromium desktop/mobile com screenshots anexados. Ainda não equivale a auditoria WCAG completa ou validação comercial. Vercel continua adiada.
