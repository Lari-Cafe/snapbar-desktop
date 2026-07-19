# Snapbar - Roadmap de Features

Plano para evoluir a Snapbar mantendo o design de roda/liquid glass. A ideia principal e usar a roda como entrada rapida: cada icone abre um painel pequeno, bonito e ancorado no proprio botao.

## Visao geral

A Snapbar deve continuar leve, flutuante e rapida. Features grandes nao devem virar telas gigantes dentro da roda; elas devem abrir paineis compactos, com clique fora para fechar, Escape para fechar e estado persistido quando fizer sentido.

## Layout da roda

### Slots principais

1. Print
2. Gravacao
3. Media
4. Typo Fire
5. Notas
6. Ferramentas
7. Configuracoes
8. Fechar

### Regras de UX

- Clique em um icone simples executa a acao.
- Clique em um icone complexo abre painel ancorado no icone.
- Segundo clique no mesmo icone fecha o painel.
- Clique fora fecha o painel.
- Painel nao pode roubar foco quando isso atrapalhar a digitacao.
- A roda continua arrastavel pelo centro e pelo aro.

## Feature: Media Player

### Objetivo

Controlar Spotify, YouTube Music, YouTube e outros players sem abrir o app principal.

### MVP

- Botao Media na roda.
- Painel com:
  - Play/Pause
  - Proxima
  - Anterior
  - Parar
  - Volume +
  - Volume -
  - Mudo
- Comandos via teclas de midia do Windows.
- Visual com cards pequenos e botoes redondos no estilo Snapbar.

### Fase avancada

- Detectar sessao ativa de midia.
- Mostrar app atual: Spotify, Chrome, Edge, YouTube Music etc.
- Mostrar titulo/artista quando o Windows expuser.
- Controle por sessao quando possivel.
- Volume por app.

### Riscos

- Volume por aba especifica do YouTube pode nao ser simples pelo Windows.
- Navegadores podem expor apenas a sessao geral, nao cada aba.
- Media keys podem afetar o ultimo player ativo, nao necessariamente o desejado.

## Feature: Atalhos de teclado

### Objetivo

Permitir controlar a Snapbar sem mouse.

### Escopo

- Atalho para mostrar/ocultar.
- Atalho para expandir/recolher.
- Atalho para print.
- Atalho para iniciar/parar gravacao.
- Atalho para abrir configuracoes.
- Atalhos do Typo Fire.
- Futuro: atalho para abrir Media Panel.

## Feature: Print

### Objetivo

Capturar tela rapido e salvar no local configurado.

### Melhorias planejadas

- Historico dos ultimos prints.
- Botao para copiar ultimo print.
- Botao para abrir pasta.
- Opcao de escolher monitor.
- Opcao de capturar regiao.

## Feature: Gravacao de tela

### Objetivo

Gravar tela com audio do sistema e/ou microfone.

### Melhorias planejadas

- Indicador mais claro de REC.
- Timer de gravacao.
- Historico dos ultimos videos.
- Botao abrir pasta.
- Presets de qualidade.
- Opcao de gravar monitor especifico.

## Feature: Typo Fire

### Objetivo

Ser o motor de snippets da Snapbar no estilo Text Blaze.

### Estado atual

- Prefixo padrao `/`.
- Presets configuraveis.
- Preview global.
- Favoritos.
- Clique fora fecha preview.
- Expansao via clipboard.

### Melhorias planejadas

- Painel rapido na roda com favoritos.
- Busca de presets.
- Import/export.
- Variaveis de data/hora.
- Forms simples.
- Melhor UX para editar muitos presets.

## Feature: Lembretes

### Objetivo

Criar lembretes rapidos com notificacao e som.

### MVP

- Painel Lembretes dentro de Ferramentas ou slot proprio.
- Criar lembrete com titulo e horario.
- Lista de lembretes de hoje.
- Soneca.
- Concluir.
- Som ligado/desligado.

### Fase avancada

- Recorrencia diaria/semanal.
- Lembretes por contexto.
- Historico.
- Mini notificacao visual perto da Snapbar.

## Feature: Notas flutuantes

### Objetivo

Criar stickers/notas pequenas na tela.

### MVP

- Slot Notas na roda.
- Mostrar 3 notas mais recentes.
- Criar nova nota.
- Editar texto.
- Fixar/desfixar.
- Fechar sem perder.
- Persistir posicao, tamanho, cor e conteudo.

### Fase avancada

- Cores por nota.
- Checklist dentro da nota.
- Busca.
- Agrupar notas.
- Integracao com speech-to-text.

## Feature: Tradutor

### Objetivo

Traduzir texto dentro da Snapbar sem abrir outra pagina.

### MVP

- Painel Tradutor em Ferramentas.
- Campo de entrada.
- Campo de resultado.
- Botao copiar.
- Idioma origem/destino.

### Fase avancada

- Detectar idioma automaticamente.
- Historico rapido.
- Traduzir texto selecionado.

## Feature: Speech-to-text

### Objetivo

Transformar fala em texto e mandar para notas quando fizer sentido.

### MVP

- Botao microfone no painel de Notas.
- Gravar fala curta.
- Transcrever para texto.
- Se passar de 150 caracteres, criar nota automaticamente.

### Riscos

- Precisa escolher motor de transcricao.
- Pode exigir permissao de microfone.
- Pode depender de internet se usar API externa.

## Feature: Otimizar PC

### Objetivo

Ter ferramentas rapidas de sistema sem virar app pesado.

### MVP seguro

- Abrir Gerenciador de Tarefas.
- Abrir Limpeza de Disco.
- Mostrar uso basico de RAM/CPU se for barato.

### Fase avancada

- Integracao opcional com Mem Reduct.
- Botao limpar memoria.
- Avisos de seguranca antes de qualquer acao agressiva.

## Arquitetura proposta

### Frontend

- `src/App.tsx`: registrar novos slots da roda.
- `src/components/RadialPanel.tsx`: painel base ancorado em icone.
- `src/components/MediaPanel.tsx`: controles de midia.
- `src/components/NotesPanel.tsx`: notas recentes.
- `src/components/ToolsPanel.tsx`: tradutor, otimizar PC e extras.
- `src/lib/app-settings.ts`: persistencia das novas preferencias.

### Rust/Tauri

- `src-tauri/src/media_controls.rs`: comandos de midia.
- `src-tauri/src/reminders.rs`: lembretes e notificacoes.
- `src-tauri/src/system_tools.rs`: ferramentas de sistema.
- `src-tauri/src/notes.rs`: persistencia/controle de notas se precisar de janelas separadas.

## Ordem recomendada

1. Criar `RadialPanel`.
2. Implementar Media Player MVP.
3. Adicionar painel rapido do Typo Fire.
4. Implementar Notas flutuantes MVP.
5. Implementar Lembretes MVP.
6. Implementar Tradutor.
7. Implementar Speech-to-text.
8. Implementar Otimizar PC com cuidado.

## Perguntas para decidir

1. O icone de Media deve substituir `Downloads` na roda ou entrar dentro de `Ferramentas`?
2. O painel de Media deve abrir ao clicar uma vez ou deve executar Play/Pause no clique e abrir painel no clique segurado?
3. O volume do Media Player no MVP pode ser volume global do Windows?
4. O YouTube/YouTube Music precisa ser controlado por aba especifica ou pode ser pelo player ativo do Windows?
5. As Notas flutuantes devem nascer perto da Snapbar ou no centro da tela?
6. As 3 notas recentes devem aparecer direto ao clicar no icone ou numa mini lista antes?
7. Lembretes devem tocar som mesmo com a Snapbar escondida no tray?
8. Tradutor pode depender de internet/API externa ou precisa funcionar offline?
9. Speech-to-text pode depender de internet/API externa ou precisa ser local?
10. Otimizar PC pode executar acoes reais de limpeza ou deve primeiro abrir ferramentas do Windows?
11. O painel `Ferramentas` deve conter Downloads, Tradutor e Otimizar PC juntos?
12. Voce quer que os slots da roda sejam reordenaveis pelo usuario no futuro?
