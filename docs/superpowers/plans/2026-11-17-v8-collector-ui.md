# Coletor de contagens V8 — Plano de implementação

> **Para execução por agentes:** aplicar teste primeiro, implementar incrementalmente e verificar cada etapa.

**Objetivo:** transformar a tela principal em um coletor rápido, preservando armazenamento local, API e proteções atuais.

**Arquitetura:** manter o app standalone existente; ocultar totais/histórico de confirmados da área principal, priorizar os campos e a câmera, mostrar apenas status compacto e expor pendências num painel recolhível. Persistência e estados remotos permanecem intactos.

**Stack:** HTML, CSS e JavaScript existentes; testes Node `node:test` e harness/mock atuais.

**Especificação:** solicitação do usuário de 17/11/2026; arquivos-alvo `Inventario_Ultra_v8.html`, `index.html`, `tests/inventory-v8.test.cjs` e `tests/inventory-v8-harness.cjs`.

## Restrições
- Não alterar contrato da API, integrações ou configurações.
- Manter cada registro local necessário à recuperação.
- Não remover nem reenviar automaticamente operações incertas.
- Não mostrar histórico de aparelho como visão consolidada.
- Manter ajustes negativos como lançamentos separados.
- Não publicar nem fazer merge.

## Foco de revisão
- Confirmação HTTP/API real versus falha/resultado incerto: toast breve, foco e status corretos.
- Pendências locais não sincronizadas versus resultado remoto incerto: rótulos distintos.
- Falha de persistência local: impedir envio e manter aviso.
- Operação incerta: nenhuma ação de apagar ou reenviar.
- Histórico antigo e dados preservados: lista secundária não pode alterar nem omitir armazenamento.

## Tarefas

### 1. Fixar comportamento no harness
- Testar que a página não tem cartões de totais nem painel fixo de registros.
- Testar que o contador de pendências permanece visível com a área recolhida e discrimina “Não enviado” de “Confirmação incerta”.
- Testar que o sucesso mostra confirmação breve, limpa o formulário e retorna foco ao código sem bloquear modal.
- Confirmar que dados locais permanecem armazenados e que incertos não ganham ação de remoção/reenvio.

### 2. Implementar o fluxo coletor
- Simplificar o markup/CSS da home, priorizando código com câmera ao lado, quantidade com controles e botão “Enviar contagem”.
- Adicionar indicador compacto com “Pronto”, “Enviando”, “Sem conexão” ou “Com pendências”, derivados do estado efetivo.
- Mover somente registros não confirmados para uma seção recolhível; incluir código, quantidade com sinal, data/hora e estado. Manter exportação de recuperação acessível e configurações discretas.
- Manter a lógica de persistência/API e do fluxo aditivo; ajustar apenas a apresentação/toast/foco necessários.

### 3. Sincronizar e verificar
- Aplicar o mesmo HTML em `index.html` e `Inventario_Ultra_v8.html`.
- Executar `node --test --test-reporter=spec tests\\inventory-v8.test.cjs` e `node --test --test-reporter=spec tests\\inventory-api.test.cjs`.
- Conferir igualdade dos HTML, diff e tema claro/escuro em viewport móvel e desktop; capturar as telas móvel solicitadas.
- Atualizar o PR existente, sem merge ou publicação.
