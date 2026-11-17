# Homologação segura do backend da V8

## Conteúdo preparado

- `backend/originals/Inventario API.gs` e `backend/originals/macros.GS` são referências copiadas do conteúdo recebido. A cópia de `macros.GS` não é carregada pelos testes, executada nem alterada.
- `backend/Inventario API.gs` é a proposta revisada. Nenhum código foi enviado ao editor ou implantado.
- `tests/apps-script-mock.cjs` simula planilha, lock, propriedades e resposta JSON. `tests/inventory-api.test.cjs` testa o backend simulado e o contrato usado pela V8.

Execute no diretório do repositório:

```text
node --test --test-reporter=spec tests\inventory-api.test.cjs
node --test --test-reporter=spec tests\inventory-v8.test.cjs
```

Esses testes são locais e não acessam Google Sheets, Apps Script, dispositivos ou a rede de produção.

## Comportamento relevante da proposta

- `add` exige código textual e quantidade inteira segura; aceita zero como lançamento de zero unidade e negativos como ajustes aditivos. Uma correção usa novo ID e nova data de gravação. O ID continua opcional por compatibilidade com clientes antigos; sem ID, o servidor gera um, mas o reenvio não é idempotente. A V8 sempre envia um ID próprio.
- Reenvio do mesmo ID com dados iguais devolve o timestamp original; dados divergentes e IDs duplicados existentes são recusados sem alteração.
- `delete` exige um único ID correspondente. A primeira exclusão cria, sob o mesmo `ScriptLock`, a aba oculta `__InventarioDeletedIds` com ID e horário de exclusão, antes de remover a linha. Essa lista de tombstones impede que uma repetição antiga de `add` recrie o ID apagado. A estrutura A:D da aba existente não recebe novas colunas.
- Se a gravação do tombstone falhar, a exclusão da linha não começa. Se o tombstone for gravado e a remoção da linha falhar, a linha permanece e o tombstone impede reutilizar o ID; repetir `delete` pelo mesmo ID pode concluir a remoção. Se a resposta se perder depois da remoção, repetir `delete` retorna sucesso idempotente. Tombstones duplicados ou com timestamp inválido bloqueiam a operação, sem escolher uma linha ou permitir reutilização silenciosa.
- Cada exclusão acrescenta uma linha permanente à aba de tombstones; as consultas atuais percorrem esses IDs, então o custo cresce com o histórico. Não há limpeza/compactação automática. O código não define volume-alvo, portanto capacidade para o volume esperado ainda precisa ser avaliada com uma estimativa de exclusões e limites aplicáveis do Sheets. `lastModified` usa uma única propriedade do script, atualizada por mutações confirmadas pela API; não cresce por lançamento e não observa edições manuais, macros ou outros escritores.
- `list` lê somente as últimas 50 linhas; `search` lê os códigos da coluna B para localizar correspondências.
- `lastModified` é guardado em Script Properties após mutações da API; consultas não atualizam o valor. Um projeto sem histórico de mutações pela API retorna `null`, pois não é seguro inventar a data inicial.
- A resposta de `add` mantém `success`, `message` e `data` (`barras`, `qtd`, `id`, `timestamp`). A V8 preserva o horário de confirmação no aparelho separadamente do timestamp recebido do servidor.

A aba `__InventarioDeletedIds` é uma necessidade adicional para impedir ressurreição após exclusão sem acrescentar colunas à aba de respostas. A proposta só a cria no projeto/planilha em que uma exclusão for efetivamente executada. Revisar esse efeito na cópia de homologação antes de qualquer uso.

## Preparar ambiente isolado

1. Faça uma cópia da planilha para homologação, preservando a aba `Respostas ao formulário 1` e suas colunas A:D. Não use a planilha real.
2. Use um projeto Apps Script de homologação vinculado à cópia. Não cole esta proposta no projeto de produção. Confirme quais executores e permissões a cópia realmente possui; isso não foi inferido aqui.
3. Implante uma URL de teste separada. Não substitua a URL salva no perfil de produção do navegador. Use perfil/dispositivo de teste isolado e configure apenas nele a URL temporária.
4. Confirme `scriptTimeZone` e `spreadsheetTimeZone` pela ação `test`; a configuração real de fuso ainda não foi fornecida.
5. Use códigos e IDs de teste identificáveis. Para quantidade, envie `+12` com um ID, depois `-2` com outro ID; confira duas linhas e soma 10. Reenvie cada ID e confira que não aparecem linhas extras. Teste um ID conflitante, duas chamadas concorrentes, exclusão por ID, reenvio de `add` após exclusão, e perda de conexão antes e depois de o servidor aceitar a gravação.
6. Execute duas sessões em aparelhos distintos contra a URL de homologação. Verifique também câmera e teclado virtual nos aparelhos reais. Os testes locais não substituem essas validações.
7. Ao encerrar, retire somente a configuração de teste do perfil isolado e descarte/limpe a cópia de homologação conforme o procedimento do responsável. Não remova registros ou configurações da produção.

O `ScriptLock` coordena chamadas críticas que chegam a este mesmo projeto Apps Script. Ele não coordena edição manual da planilha, macros, outros projetos/scripts ou escritores que não adquiram esse lock. O timestamp registrado é o horário do servidor ao executar a gravação; não é o horário de coleta do aparelho.

## Macro e limites de verificação

A cópia recebida de `macros.GS` contém uma função que seleciona as linhas 2 a 10076 e executa `deleteRows`; executá-la pode apagar milhares de linhas. Não foi executada nem modificada. O código isolado não revela se está vinculada a uma macro do Sheets, botão/desenho, menu ou acionador instalado. Verifique esses vínculos no projeto e na planilha de homologação antes de decidir qualquer proteção ou substituição. A proposta da API não depende dessa macro.

Não foram fornecidos `appsscript.json`, configuração do projeto, fuso real, permissões, URL da API que está salva no aparelho nem metadados de implantação. Assim, não foi possível confirmar que o link do editor corresponde à URL atualmente usada. O código recebido não contém checagem explícita de autenticação; isso não basta para concluir que o endpoint está público ou seguro, pois dependem também das opções de acesso/execução do deployment, que permanecem pendentes de inspeção. Testes com mocks não comprovam isolamento, lock real, fusos, comportamento do Sheets, nem sincronização física entre aparelhos.

## Atualização e reversão

A proposta não foi implantada. Para homologar, use primeiro um deployment de teste independente, apontado à cópia da planilha. A implantação de produção só deve ser alterada após aprovação explícita. No Apps Script, editar a implantação existente em **Deploy > Manage deployments**, selecionar a nova versão e atualizar essa mesma implantação normalmente mantém sua URL; confirmar o URL exibido antes e depois é obrigatório. Não crie nem atualize deployment de produção nesta etapa.

Para reverter a homologação, reimplante a versão anterior do deployment de teste ou descarte o projeto e a cópia de teste. A reversão de produção não deve limpar histórico local nem apagar linhas da planilha. A macro destrutiva permanece fora do procedimento de reversão.
