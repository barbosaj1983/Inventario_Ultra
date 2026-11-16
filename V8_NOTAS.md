# Inventário Ultra V8

A V8 mantém a API e as configurações existentes. Grava cada lançamento primeiro no armazenamento local, com ID próprio, data, hora com segundos e timestamp UTC; a confirmação da API e as respostas remotas incertas são identificadas separadamente. O histórico completo permanece no aparelho; a interface mostra até 15 registros recentes e os totais são locais. Ajustes negativos continuam usando a operação `add` existente; o suporte do Apps Script não foi verificado.

A interface foi reorganizada para contagem mobile-first, com resumo local, estados explícitos de sincronização, temas claro/escuro e configurações aplicadas somente ao salvar. Não foram adicionados serviços ou dependências; ícones usam SVG embutido e a tipografia usa fontes do sistema. `index.html` e `Inventario_Ultra_v8.html` devem permanecer idênticos.

O cadastro CSV aceita somente respostas com cabeçalho `BARRAS`, preserva códigos como texto e usa o último cache válido quando a rede falha. Histórico local inválido é arquivado sem descarte silencioso. Exportar produz CSV do aparelho, não backup completo da planilha.

## Verificação

Execute `node --test tests/inventory-v8.test.cjs`. Os 23 testes usam armazenamento, API e scanner simulados; não acessam nem alteram planilhas. Incluem preservação do estado das configurações, Cancelar/Salvar e foco do teclado. Não há código Apps Script nem fluxo de publicação no repositório para auditar. Testes reais com câmera, aparelhos simultâneos e planilha ainda são necessários após confirmar o suporte do backend a quantidades negativas e operações por ID.

## Reversão

Reverta o commit da V8 ou volte a servir `Inventario_Ultra_v7.html` pelo mecanismo de publicação confirmado pelo responsável. Não limpe `localStorage`, não apague linhas da planilha e não substitua configurações; exporte e preserve registros locais pendentes/incertos antes de reverter.
