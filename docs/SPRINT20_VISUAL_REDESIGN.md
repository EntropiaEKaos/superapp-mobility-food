# Sprint 20 — Redesign visual e navegação mobile

## O que mudou
- Landing editorial renovada, com hero bifurcado, mapa esquemático e cartão sólido de viagem ilustrativa.
- Cards de corridas e delivery com hierarquia, espaço e contraste reforçados.
- No celular, menu inferior fixo com quatro destinos (Corridas, Delivery, Parceiros e Conta), que substitui a navegação que escondia as seções.
- Link de acessibilidade “Pular para o conteúdo” como primeiro destino do teclado, foco visível e respeito a movimento reduzido.
- Rodapé e descrições revistos para comunicar que tudo permanece demonstração.
- Teste Playwright da Sprint 19 expandido para validar link de salto e menu inferior visível no mobile e continuar produzindo 12 screenshots.

## O que não mudou
- Banco, autenticação, APIs de parceria, motor fictício de despacho, cálculo de frete e SSE/Redis permanecem inalterados.
- Nenhum motorista, restaurante, pagamento, GPS ou despacho real foi ativado.
- O desenvolvimento fica no GitHub. Vercel continua adiada.

## QA obrigatório
A integração só é aprovada com os cinco jobs: lint/typecheck/build, Postgres/Auth, Redis/outbox, homologação e Chromium real desktop/mobile. Imagens no artifact `sprint19-browser-screenshots` do workflow do PR, disponíveis por 14 dias.

## Próximas etapas
Revisar visualmente as capturas em telas de 390px e 1440px; aprimorar catálogo e estimador, testar elementos com teclado e leitor de tela, e posteriormente configurar aprovação de baseline visual. Captura de tela não é teste de contraste ou WCAG completo.
