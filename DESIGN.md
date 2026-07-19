# Snapbar DESIGN.md

## Produto

Snapbar é uma toolbar flutuante para Windows que coloca ações comuns em um ponto rápido da tela: gravação, ditado por voz do Windows, downloads, mixer, calendário, pomodoro, notas, captura, Typo Fire e configurações.

O produto deve parecer uma ferramenta vendável para usuário comum: leve, local-first, sem erro técnico exposto e sem exigir ambiente de programação.

## Assinatura visual

Referência atual pelos screenshots locais:

- Barra horizontal: cápsula branca translúcida, cantos grandes, sombra suave, ícones pretos lineares e espaçamento uniforme.
- Barra vertical: mesma cápsula, largura estreita, ícones centralizados em coluna e ordem invertida conforme ancoragem.
- Estado expandido: superfície limpa, com glass/blur sutil e sem decoração excessiva.
- Estado recolhido: alvo único claro para expandir/arrastar.

Tokens vivos ficam em `src/styles/design-system.css`:

- cor/acento: `--snap-accent`
- vidro: `--snap-bg`, `--snap-bg-strong`, `--snap-glass-blur`, `--snap-glass-opacity`, `--snap-glass-saturation`
- texto: `--snap-text`, `--snap-text-dim`, `--snap-text-faint`
- borda/sombra: `--snap-border`, `--snap-border-strong`, `--snap-highlight`, `--snap-shadow`
- movimento: `--snap-motion-speed`, `--snap-ease-glass`

## Arquitetura atual mapeada

Graphify em 2026-07-02:

- 180 arquivos analisados
- 2123 nós
- 4549 arestas
- 127 comunidades
- sem ciclos de import detectados

Hubs principais:

- `src/App.tsx`: janela principal/toolbar, ações, drag, estado visual, chamadas Tauri.
- `src/lib/toolbar-layout.ts`: cálculo de tamanho e geometria da toolbar.
- `src/styles/design-system.css`: tokens globais e temas.
- `src/App.css`: implementação visual da toolbar flutuante atual.
- `src/lib/app-settings.ts`: presets, comportamento e aparência.
- `src-tauri/src/*`: comandos nativos, downloads, gravação, Typo Fire, notas e janelas auxiliares.

## Problema central

O Snapbar está funcional, mas o fluxo principal está concentrado demais em `src/App.tsx`.

Isso cria três riscos:

1. alteração visual da toolbar pode quebrar comportamento de janela/drag;
2. alteração de ação pode quebrar layout ou feedback;
3. componentes novos podem ficar órfãos sem substituir o fluxo real.

## Regras de organização

1. Não reescrever a toolbar inteira de uma vez.
2. Primeiro separar dados puros e funções testáveis; depois separar componente visual.
3. Manter `src/lib/toolbar-layout.ts` como fonte única para dimensões.
4. Manter `src/styles/design-system.css` como fonte única para tokens visuais.
5. Só remover arquivos marcados pelo Knip depois de confirmar entrypoints Tauri, rotas hash e testes.
6. `graphify-out/` é artefato local de análise, não runtime do produto.

## Fatias seguras de melhoria

### Fatia 1 — contrato e mapa

- Gerar/atualizar Graphify com `graphify update .`.
- Manter este `DESIGN.md` como contrato de arquitetura e visual.
- Não alterar comportamento funcional.

### Fatia 2 — reduzir `App.tsx` sem mudar UX

Extrair de `App.tsx` para um arquivo pequeno:

- tipo/definição de `ActionId` e `ToolbarAction`;
- construção da lista de ações da toolbar;
- labels dependentes de `mediaActionPending`, `mediaState` e `speechState`.

Critério de pronto: `npm run test` e `npm run build` passam.

### Fatia 3 — unificar toolbar visual

`SnapAdaptiveToolbar` foi removido como protótipo morto. A toolbar real continua em `src/App.tsx` usando `src/lib/toolbar-actions.ts` e `src/lib/toolbar-layout.ts`.

Critério de pronto: screenshots horizontal/vertical continuam com cápsula limpa, ícones centralizados e alvo de drag/expandir claro.

### Fatia 4 — limpar dependências e mortos

Usar `npx knip --reporter compact` como sinal, não como verdade absoluta.

Confirmar antes de remover:

- rotas em `src/main.tsx`;
- webviews/janelas em `src-tauri/tauri.conf.json`;
- imports dinâmicos e testes.

## Comandos de workflow

```bash
graphify update .
graphify query "App.tsx toolbar floating actions toolbar-layout design-system" --budget 2200
npx knip --reporter compact
npm run test
npm run build
```

## Decisão atual

Próxima mudança de código recomendada: **limpar dependências e protótipos restantes apontados pelo Knip**, sem mexer na toolbar real nem em `package.json` até confirmar entrypoints e janelas Tauri.
