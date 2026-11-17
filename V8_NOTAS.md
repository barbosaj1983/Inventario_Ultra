# Inventário Ultra V8

A V8 mantém o contrato existente da API. Grava cada lançamento primeiro no armazenamento local, com ID próprio, data, hora com segundos e timestamp UTC; a confirmação no aparelho, o timestamp retornado pelo servidor e respostas remotas incertas são mantidos separadamente. O histórico completo permanece no aparelho; a seção recolhível mostra somente registros não confirmados, distinguindo "Não enviado" de "Confirmação incerta", e mantém o contador visível fechada. Ajustes negativos continuam usando `add`; a proposta de backend está em `backend/Inventario API.gs` e ainda precisa de homologação isolada.

A interface funciona como coletor mobile-first: prioriza código, câmera, quantidade e envio, sem totais locais ou histórico permanente; mostra um indicador compacto, pendências recolhíveis e exportação discreta. Temas claro/escuro e configurações existentes foram preservados. Não foram adicionados serviços ou dependências; ícones usam SVG embutido e a tipografia usa fontes do sistema. `index.html` e `Inventario_Ultra_v8.html` devem permanecer idênticos. A URL padrão da API permanece vazia; `/mock` foi usado apenas pelo servidor temporário da prévia isolada, fora do repositório.

O cadastro CSV aceita somente respostas com cabeçalho `BARRAS`, preserva códigos como texto e usa o último cache válido quando a rede falha. Histórico local inválido é arquivado sem descarte silencioso. Exportar produz CSV do aparelho, não backup completo da planilha.

## Verificação

Execute `node --test --test-reporter=spec tests\\inventory-v8.test.cjs tests\\inventory-api.test.cjs tests\\homologation-page.test.cjs`. Na última execução local, 65 testes automatizados passaram; as suítes simulam armazenamento, API, scanner, Apps Script/Sheets e a configuração da página isolada. Incluem retomada de pendências no carregamento e após reconexão, sem reenviar automaticamente resultados incertos. Nenhum teste automatizado escreve ou exclui linhas em planilhas reais. Os originais recebidos estão em `backend/originals/`; `macros.GS` foi preservado sem execução ou modificação. A homologação real descrita abaixo usou a planilha de testes, não a de produção; permissões e autenticação do deployment, vínculos da macro, câmera e teclado virtual em aparelhos reais continuam pendentes.

## Teste real de retomada da sincronização

Em 17/11/2026, a coleta local `440578`, quantidade `+1`, às `18:13:35`, foi retomada após atualização e confirmada. O CSV de recuperação do aparelho mostrou ID local/remoto `mwl91dow-2l13iau5gp9`, estado `confirmed`, cadastro `verified`, gravação confirmada pelo servidor `2026-11-17T23:14:05.933Z` e confirmação recebida no aparelho `2026-11-17T23:14:07.515Z`; o usuário informou zero pendências no aparelho. A consulta somente de leitura `action=list` à planilha de homologação retornou 7 registros e o ID `mwl91dow-2l13iau5gp9` apareceu exatamente uma vez, na linha 7, com código `440578` e quantidade `1`. O ID `mwlb7hjo-icdd3o6dn9n` é outra coleta local e não foi contado como a operação original. A consulta devolveu o timestamp da célula com milissegundos zerados (`2026-11-17T23:14:05.000Z`); isso mantém aberta a investigação registrada em `backend/HOMOLOGACAO.md`, sem alteração de dados.

## Reversão

Reverta o commit da V8 ou volte a servir `Inventario_Ultra_v7.html` pelo mecanismo de publicação confirmado pelo responsável. Não limpe `localStorage`, não apague linhas da planilha e não substitua configurações; exporte e preserve registros locais pendentes/incertos antes de reverter.
