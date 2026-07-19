import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import {
  appearanceForPreset,
  loadAppearanceSettings,
  loadBehavior,
  saveAppearanceSettings,
  saveBehavior,
  type AppearanceSettings,
  type BehaviorSettings,
  type GlassIntensity,
  type ToolbarOrientation,
  type ToolbarSizeMode,
  type VisualPreset,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_BEHAVIOR,
} from "../../lib/app-settings";
import { applyAppearanceSettings } from "../../lib/apply-appearance";

interface SectionJanelaProps { onSaved: () => void; }

async function emitChanged(behavior: BehaviorSettings): Promise<void> {
  try { await emit("settings://changed", { behavior }); }
  catch (err) { console.warn("[settings] emit failed:", err); }
}

async function emitAppearanceChanged(appearance: AppearanceSettings): Promise<void> {
  try { await emit("settings://changed", { appearance }); }
  catch (err) { console.warn("[settings] emit failed:", err); }
}

export function SectionJanela({ onSaved }: SectionJanelaProps) {
  const [behavior, setBehavior] = useState<BehaviorSettings>(DEFAULT_BEHAVIOR);
  const [appearance, setAppearance] = useState<AppearanceSettings>(DEFAULT_APPEARANCE_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadBehavior();
      const loadedAppearance = await loadAppearanceSettings();
      if (!cancelled) {
        setBehavior(loaded);
        setAppearance(loadedAppearance);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = async (patch: Partial<BehaviorSettings>) => {
    const next = await saveBehavior({ ...behavior, ...patch });
    setBehavior(next);
    await emitChanged(next);
    onSaved();
  };

  const updateOpacity = (value: number) => update({ inactiveOpacity: value }).catch((err) => console.warn("[settings] opacity update failed:", err));
  const updateToolbarSize = (value: ToolbarSizeMode) => update({ toolbarSizeMode: value }).catch((err) => console.warn("[settings] toolbar size update failed:", err));
  const updateToolbarOrientation = (value: ToolbarOrientation) => update({ toolbarOrientation: value }).catch((err) => console.warn("[settings] toolbar orientation update failed:", err));

  const updatePreset = async (preset: VisualPreset) => {
    const next = await saveAppearanceSettings(appearanceForPreset(preset, appearance));
    setAppearance(next);
    applyAppearanceSettings(next);
    await emitAppearanceChanged(next);
    onSaved();
  };

  const updateGlassIntensity = async (glassIntensity: GlassIntensity) => {
    const next = await saveAppearanceSettings(appearanceForPreset(appearance.preset, { ...appearance, glassIntensity }));
    setAppearance(next);
    applyAppearanceSettings(next);
    await emitAppearanceChanged(next);
    onSaved();
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Janela</h2>
      <p className="settings-section-hint">Comportamento da toolbar flutuante.</p>

      <div className="settings-card">
        <div className="settings-row settings-row-stacked">
          <div className="settings-row-text">
            <span className="settings-row-label">Visual do app</span>
            <span className="settings-row-desc">Padrão mantém o visual atual. Liquid Glass muda só a toolbar por enquanto.</span>
          </div>
          <div className="settings-preset-row" aria-label="Visual do app">
            {[["default", "Padrão"], ["liquidGlass", "Liquid Glass"]].map(([preset, label]) => (
              <button key={preset} type="button" className={`settings-preset-btn${appearance.preset === preset ? " active" : ""}`} onClick={() => updatePreset(preset as VisualPreset)}>{label}</button>
            ))}
          </div>
        </div>

        {appearance.preset === "liquidGlass" ? (
          <div className="settings-row settings-row-stacked">
            <div className="settings-row-text">
              <span className="settings-row-label">Intensidade do vidro</span>
              <span className="settings-row-desc">Ajusta blur e refração da toolbar, sem mexer nas outras janelas.</span>
            </div>
            <select className="settings-select" value={appearance.glassIntensity} onChange={(e) => updateGlassIntensity(e.target.value as GlassIntensity)} aria-label="Intensidade do vidro">
              <option value="soft">Suave</option><option value="medium">Médio</option><option value="strong">Forte</option>
            </select>
          </div>
        ) : null}

        <label className="settings-row">
          <input type="checkbox" checked={behavior.alwaysOnTop} onChange={(e) => update({ alwaysOnTop: e.target.checked })} />
          <div className="settings-row-text"><span className="settings-row-label">Sempre no topo</span><span className="settings-row-desc">A toolbar fica acima de outras janelas.</span></div>
        </label>

        <div className="settings-row settings-row-stacked">
          <div className="settings-row-text"><span className="settings-row-label">Opacidade quando inativa</span><span className="settings-row-desc">Reduz a visibilidade da toolbar quando o cursor não está sobre ela.</span></div>
          <div className="settings-slider-row">
            <input type="range" min={10} max={100} step={5} value={behavior.inactiveOpacity} onChange={(e) => updateOpacity(Number(e.target.value))} className="settings-slider" aria-label="Opacidade quando inativa" />
            <input type="number" min={10} max={100} step={5} value={behavior.inactiveOpacity} onChange={(e) => updateOpacity(Number(e.target.value))} className="settings-number" aria-label="Valor da opacidade quando inativa" />
            <span className="settings-slider-value">{behavior.inactiveOpacity}%</span>
          </div>
          <div className="settings-preset-row" aria-label="Predefinições de opacidade">
            {[25, 50, 75, 100].map((value) => <button key={value} type="button" className={`settings-preset-btn${behavior.inactiveOpacity === value ? " active" : ""}`} onClick={() => updateOpacity(value)}>{value}%</button>)}
          </div>
        </div>

        <label className="settings-row">
          <input type="checkbox" checked={behavior.autoHide} onChange={(e) => update({ autoHide: e.target.checked })} />
          <div className="settings-row-text"><span className="settings-row-label">Recolher ao perder foco</span><span className="settings-row-desc">A toolbar volta para o modo bolinha quando você clica fora dela.</span></div>
        </label>

        <div className="settings-row settings-row-stacked">
          <div className="settings-row-text"><span className="settings-row-label">Orientação da toolbar</span><span className="settings-row-desc">Horizontal é o padrão. Vertical usa os mesmos botões em coluna.</span></div>
          <select className="settings-select" value={behavior.toolbarOrientation} onChange={(e) => updateToolbarOrientation(e.target.value as ToolbarOrientation)} aria-label="Orientação da toolbar"><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select>
        </div>

        <div className="settings-row settings-row-stacked">
          <div className="settings-row-text"><span className="settings-row-label">Tamanho da toolbar</span><span className="settings-row-desc">Automático mantém o tamanho atual e reduz em telas pequenas.</span></div>
          <select className="settings-select" value={behavior.toolbarSizeMode} onChange={(e) => updateToolbarSize(e.target.value as ToolbarSizeMode)} aria-label="Tamanho da toolbar"><option value="auto">Automático</option><option value="default">Padrão</option><option value="compact">Compacto</option><option value="mini">Mini</option></select>
        </div>
      </div>
    </section>
  );
}
