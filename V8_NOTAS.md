# Inventário Ultra V8

A V8 mantém o contrato existente da API. Grava cada lançamento primeiro no armazenamento local, com ID próprio, data, hora com segundos e timestamp UTC; a confirmação no aparelho, o timestamp retornado pelo servidor e respostas remotas incertas são mantidos separadamente. O histórico completo permanece no aparelho; a seção recolhível mostra somente registros não confirmados, distinguindo "Não enviado" de "Confirmação incerta", e mantém o contador visível fechada. Ajustes negativos continuam usando `add`; a proposta de backend está em `backend/Inventario API.gs` e ainda precisa de homologação isolada.

A interface funciona como coletor mobile-first: prioriza código, câmera, quantidade e envio, sem totais locais ou histórico permanente; mostra um indicador compacto, pendências recolhíveis e exportação discreta. Temas claro/escuro e configurações existentes foram preservados. Não foram adicionados serviços ou dependências; ícones usam SVG embutido e a tipografia usa fontes do sistema. `index.html` e `Inventario_Ultra_v8.html` devem permanecer idênticos. A URL padrão da API permanece vazia; `/mock` foi usado apenas pelo servidor temporário da prévia isolada, fora do repositório.

O cadastro CSV aceita somente respostas com cabeçalho `BARRAS`, preserva códigos como texto e usa o último cache válido quando a rede falha. Histórico local inválido é arquivado sem descarte silencioso. Exportar produz CSV do aparelho, não backup completo da planilha.

## Verificação

Execute `node --test --test-reporter=spec tests\\inventory-v8.test.cjs tests\\inventory-api.test.cjs tests\\homologation-page.test.cjs`. Na validação atual, 50 testes automatizados passaram; as suítes simulam armazenamento, API, scanner, Apps Script/Sheets e a configuração da página isolada. Incluem falha de exclusão após gravar tombstone, repetição segura e bloqueio de IDs com tombstone inválido. Nenhum teste escreve ou exclui linhas em planilhas reais. Os originais recebidos estão em `backend/originals/`; `macros.GS` foi preservado sem execução ou modificação. O backend proposto ainda não foi implantado. Homologação em planilha separada, horários/fusos reais, permissões, autenticação, vínculos da macro e testes com dois aparelhos, câmera e teclado virtual continuam pendentes.

## Reversão

Reverta o commit da V8 ou volte a servir `Inventario_Ultra_v7.html` pelo mecanismo de publicação confirmado pelo responsável. Não limpe `localStorage`, não apague linhas da planilha e não substitua configurações; exporte e preserve registros locais pendentes/incertos antes de reverter.
