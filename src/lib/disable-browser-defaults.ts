// Bloqueia comportamentos padrão do WebView2 que não fazem sentido num app
// desktop: menu de contexto (Voltar/Atualizar/Imprimir/Inspecionar), atalhos
// de reload (Ctrl+R, F5), print (Ctrl+P), find (Ctrl+F, Ctrl+G) e zoom (Ctrl+±).
//
// Em dev fica liberado pra usar Inspecionar / Atualizar; em build (release)
// fica bloqueado.

export function disableBrowserDefaults(): void {
  // Mantém devtools/reload em dev pra debug. import.meta.env.DEV é true em vite dev.
  const isDev = Boolean((import.meta as any).env?.DEV);

  // Context menu (botão direito)
  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  // Atalhos de teclado
  window.addEventListener("keydown", (e) => {
    // F5 / Ctrl+R / Ctrl+Shift+R: reload
    if (
      !isDev &&
      (e.key === "F5" ||
        ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R")))
    ) {
      e.preventDefault();
      return;
    }
    // Ctrl+P: print
    if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      return;
    }
    // Ctrl+F / Ctrl+G: find in page
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === "f" || e.key === "F" || e.key === "g" || e.key === "G")
    ) {
      e.preventDefault();
      return;
    }
    // Ctrl+S: save page
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      return;
    }
    // Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0: zoom
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0")
    ) {
      e.preventDefault();
      return;
    }
  });

  // Drag de seleção de texto pode iniciar drag-image em alguns elementos.
  // Bloqueia o dragstart global pra não atrapalhar o drag manual da janela.
  window.addEventListener("dragstart", (e) => {
    e.preventDefault();
  });
}
