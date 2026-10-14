# Libri RSVP: idade das crianças e liberação segura

## Uso
Em **Admin > Editar evento > Campos opcionais**, ativar **Idade de cada criança (na confirmação)**. O padrão é desligado, inclusive em eventos existentes.

Quando ativada, toda **criança marcada como "Vai"** precisa informar idade em anos completos, de **0 a 17**. Use 0 para crianças menores de um ano. Crianças que não vão não precisam preencher idade. A informação fica vinculada a cada integrante da família, não ao responsável.

Na **Visão geral**, as idades das crianças confirmadas aparecem nas faixas 0–2, 3–5, 6–9, 10–12, 13–17 e Sem idade (cadastros anteriores que ainda não preencheram). O **CSV** contém coluna própria de idades, além da idade junto ao nome; o **PDF** mostra a idade por criança.

## Migração do banco (obrigatória ANTES do deploy)
A atualização **0007_child_ages.sql** adiciona uma coluna opcional ao banco existente. Ela não apaga nem preenche dados antigos. Não executar automaticamente.

1. Confirmar qual D1 de produção está conectado ao Worker `libri-rsvp`, sem acessar os D1 de outros aplicativos.
2. Preservar um backup recuperável do D1 e verificar a versão/esquema antes da mudança.
3. Aplicar somente a migração `migrations/0007_child_ages.sql` no D1 específico do RSVP.
4. Conferir a coluna `child_age` em `guest_members`, mantendo os dados antigos e os limites individuais das famílias.
5. Executar o **Deploy Libri RSVP** manual `workflow_dispatch`, sem alterar o workflow para deploy automático.
6. Abrir o painel no celular e testar com família fictícia (2 adultos e 1 criança), verificando digitação 0 -> 1, permanência do número após salvar, confirmação da idade 0 e exportações.
7. Conferir novamente os cadastros feitos enquanto o formulário antigo estava no ar. **Não** alterar os valores salvos sem conferência.

**Importante:** Não publicar o Worker atualizado antes de aplicar a migração: a consulta da visão geral usa a nova coluna.

## Testes
`npm run check`, `npm test` e teste de navegador (isolado) no PR; integração local com D1 fictício valida idade obrigatória, resumo, CSV e fluxo livre.

## Segurança de dados
Idade exata (não data de nascimento), dados de menores restritos ao painel privado e ao fluxo da própria confirmação; campos antigos continuam nulos. A desativação do campo não apaga idades armazenadas.
