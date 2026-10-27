# Sprint 09 — leitura quase em tempo real e visualização de percurso fictício

## Entrega
A central de operações em `/admin/sandbox-rides` mantém a segurança e o isolamento das sprints anteriores e passa a atualizar **automaticamente os dados a cada 6 segundos**, enquanto a aba está visível.

A atualização **não é tempo real por push**: é polling GET, sem WebSockets ou SSE. O navegador interrompe as consultas ao ocultar a aba, usa `AbortController` para descartar respostas antigas, pausa durante operações de escrita e exibe seu estado de sincronização. Se a leitura falhar, apresenta falha de conexão e aumenta o intervalo de nova tentativa, limitado a 30 segundos. A atualização automática pode ser desligada pelo operador; o botão de atualização manual continua disponível.

O componente `SandboxRoutePreview` desenha um roteiro visual **esquemático**, não um mapa geográfico: posição relativa de 0 a 50% corresponde aos cinco passos simulados até o embarque, e de 50 a 100% aos cinco passos simulados até o destino. Não representa trânsito, ETA, GPS ou percurso de ruas.

## Garantias e limites
- O polling chama somente `GET /api/admin/sandbox-rides`, protegido por sessão ADMIN, feature flag e `Cache-Control: private, no-store`.
- Não há envio de notificações, dados reais, pagamentos ou despacho.
- O usuário pode pausar e retomar a atualização; uma aba oculta interrompe o trabalho de rede.
- Leituras regulares não devem alterar o número de corridas e eventos persistidos.
- Eventos e estados continuam sendo gravados somente pelas transações do backend, nunca pelo componente visual.
- A implementação é apropriada apenas para o laboratório e não equivale a uma arquitetura escalável com atualização em tempo real; futura produção exigirá políticas de consulta, paginação e possivelmente eventos em tempo real.

## Verificação
O teste PostgreSQL da CI confirma que a interface ADMIN apresenta os controles, que o esquema ilustrativo aparece para uma corrida ativa e que duas leituras GET não inserem eventos. Permanecem executados os testes de concorrência, auth, migrações e smoke do modo demo sem banco.

A Vercel fica para uma etapa posterior, conforme solicitado.
