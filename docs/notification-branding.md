# Branding de notificacoes

A Verto monta notificacoes de consulta com prioridade para a marca da clinica ou do profissional cliente.

## Prioridade de marca

1. Clinica com nome ou logo configurado.
2. Profissional com nome ou logo configurado.
3. Fallback final da Verto.

Essa regra fica centralizada em `resolveBrandingContext`, e o mesmo contexto alimenta o payload push e o popup interno aberto apos o clique.

## Campos personalizados no push

O app personaliza `title`, `body`, `icon`, `badge`, `tag`, `data`, `url` e `actions` quando o navegador suporta esses campos.

## Limite de navegador/SO

Web Push e PWAs podem exibir automaticamente o dominio/origin da aplicacao, como `www.appverto.com.br`, em areas controladas pelo navegador ou sistema operacional. A Verto nao tenta ocultar ou mascarar esse origin por hacks, porque isso seria inseguro e inconsistente entre navegadores.

O que a aplicacao controla com seguranca e: titulo, corpo, icones, dados de clique, acoes e a experiencia interna aberta no app.
