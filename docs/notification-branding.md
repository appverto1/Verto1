# Branding de notificacoes

A Verto monta notificacoes de consulta com prioridade para a marca institucional da clinica.

## Prioridade de marca

1. Clinica com nome ou logo configurado.
2. Nome institucional seguro da organizacao, quando disponivel.
3. Fallback neutro "Clinica" sem injetar um icone Verto no payload quando nao houver logo cadastrado.

Essa regra fica centralizada em `resolveBrandingContext`, e o mesmo contexto alimenta o payload push e o popup interno aberto apos o clique.

## Campos personalizados no push

O app personaliza `title`, `body`, `icon`, `badge`, `tag`, `data` e `url` quando o navegador suporta esses campos.

## Limite de navegador/SO

Web Push e PWAs podem exibir automaticamente o dominio/origin da aplicacao, como `www.appverto.com.br`, em areas controladas pelo navegador ou sistema operacional. A Verto nao tenta ocultar ou mascarar esse origin por hacks, porque isso seria inseguro e inconsistente entre navegadores.

O nome estatico da PWA e neutro (`Portal`). Nome e logo especificos da clinica ficam nos campos controlaveis da notificacao; a atribuicao superior do navegador nao pode variar por tenant em um unico origin.
O icone estatico dessa atribuicao tambem e neutro; o logo institucional da clinica aparece no campo `icon` da notificacao.

O que a aplicacao controla com seguranca e: titulo, corpo, icones, dados de clique, acoes e a experiencia interna aberta no app.
