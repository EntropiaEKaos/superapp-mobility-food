# Sprint 19 — QA visual automatizado com Playwright

Esta sprint acrescenta uma suíte **Chromium real e headless**, executada como quinto job do GitHub Actions. Ainda não há deploy, aparelhos físicos ou testes do sistema comercial em operação.

## Cobertura

O script `scripts/visual-browser-smoke.mjs` inicia o Next.js compilado em modo demonstração e verifica, separadamente, dois contextos de navegador:

- Desktop **1440×900**.
- Mobile **390×844**, com emulação de toque.

Em cada contexto são realizadas navegação da página inicial até corridas, cotação ilustrativa por API real (com troca de categoria e bloqueio para origem/destino iguais), catálogo de restaurantes, cardápio, páginas de parceiros, login desabilitado e navegação com teclado. O script verifica transbordamento horizontal em todas as páginas testadas, erros JavaScript globais e algumas regras de acessibilidade funcional.

Gera screenshots de página inteira de `home`, `rides`, `food`, `menu`, `partners` e `login`, nas duas resoluções, totalizando **12 capturas** quando toda a suíte passa. Produz também `report.json` e `report.md`.

## Como visualizar os resultados

No GitHub, abra a execução de CI do PR e selecione o artifact `sprint19-browser-screenshots`, no fim da página. Ele inclui os PNGs e relatórios. O upload ocorre mesmo em caso de falhas, desde que algum arquivo tenha sido produzido. A retenção é de 14 dias.

## Limitações

- QA automatizado de **Chromium**; não substitui Safari, Firefox nem testes em dispositivos físicos.
- Verificar overflow, teclado e erros JS não é uma auditoria WCAG completa nem mede contraste e usabilidade por si só.
- Captura de screenshots ainda não compara diferenças em pixels contra um baseline aprovado; o objetivo é produzir evidências para análise visual e evitar regressões funcionais.
- As jornadas autenticadas de cliente/ADMIN seguem no quarto job de homologação da Sprint 18, usando PostgreSQL efêmero. Este novo job visual roda **sem banco e sem login ativo**, isolado do ambiente de usuários.
- Nenhuma integração com GPS, motorista real, despacho real, checkout, pagamento, pedido ou entrega está ativa.
- A Vercel segue adiada como solicitado.

## Próximas evoluções

Análise dos screenshots para ajustes de UI e responsividade, teste de navegador autenticado usando PostgreSQL de homologação, acessibilidade com ferramentas especializadas, aprovação de baseline visual e teste em dispositivos físicos antes de iniciar a implantação.
