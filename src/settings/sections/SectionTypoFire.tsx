import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  Flame,
  HelpCircle,
  Import,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import {
  DEFAULT_TYPO_FIRE_SETTINGS,
  loadTypoFireMatches,
  loadTypoFireSettings,
  sanitizeTypoFirePrefix,
  saveTypoFireMatches,
  saveTypoFireSettings,
  type TypoFireMatch,
  type TypoFireMatchType,
  type TypoFireSettings,
} from "../../lib/app-settings";
import { userFacingError } from "../../lib/user-facing-errors";

interface SectionTypoFireProps {
  onSaved: (message?: string) => void;
  onError: (message: string) => void;
}

interface MatchDraft {
  id?: string;
  label: string;
  triggers: string;
  replace: string;
  matchType: TypoFireMatchType;
  enabled: boolean;
  favorite: boolean;
}

interface TypoFireEngineStatus {
  enabled: boolean;
  loadedMatches: number;
  backend: "clipboard";
  hookActive: boolean;
  lastError?: string | null;
  keystrokesSeen: number;
  lastActivityAt?: string | null;
}

interface TypoFireChangedPayload {
  typoFire?: {
    settings: TypoFireSettings;
    matches: TypoFireMatch[];
  };
}

const EMPTY_DRAFT: MatchDraft = {
  label: "",
  triggers: "",
  replace: "",
  matchType: "literal",
  enabled: true,
  favorite: false,
};

const prefixOptions = ["/", ";", ":", "!"];

function ToggleSwitch({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`settings-switch${checked ? " is-on" : ""}`}
      onClick={onClick}
      aria-pressed={checked}
    >
      <span className="settings-switch-track" aria-hidden>
        <span className="settings-switch-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}

function PresetChip({
  match,
  onEdit,
  onFavorite,
  onRemove,
  onToggle,
}: {
  match: TypoFireMatch;
  onEdit: (match: TypoFireMatch) => void;
  onFavorite: (id: string, favorite: boolean) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return (
    <div className="typo-fire-preset">
      <button
        type="button"
        className={`typo-fire-favorite${match.favorite ? " active" : ""}`}
        onClick={() => onFavorite(match.id, !match.favorite)}
        title={match.favorite ? "Remover dos favoritos" : "Favorito"}
        aria-label={match.favorite ? "Remover dos favoritos" : "Favorito"}
        aria-pressed={match.favorite}
      >
        <Star
          size={13}
          strokeWidth={2}
          absoluteStrokeWidth
          fill={match.favorite ? "currentColor" : "none"}
        />
      </button>
      <button
        type="button"
        className={`typo-fire-status${match.enabled ? " active" : ""}`}
        onClick={() => onToggle(match.id, !match.enabled)}
        aria-pressed={match.enabled}
      >
        {match.enabled ? "Ativo" : "Pausado"}
      </button>
      <button
        type="button"
        className="typo-fire-preset-main"
        onClick={() => onEdit(match)}
        title="Editar snippet"
        aria-label={`Editar snippet ${match.label}`}
      >
        <span className="typo-fire-preset-label">{match.label}</span>
        <span className="typo-fire-preset-trigger">{match.triggers.join(", ")}</span>
        <span className="typo-fire-preset-text">{presetTextPreview(match.replace)}</span>
        <span className="sr-only">Preset salvo</span>
      </button>
      <div className="settings-row-actions typo-fire-preset-actions">
        <button
          type="button"
          className="settings-icon-action"
          onClick={() => onEdit(match)}
          title="Editar snippet"
          aria-label="Editar snippet"
        >
          <Pencil size={14} strokeWidth={2} absoluteStrokeWidth />
        </button>
        <button
          type="button"
          className="settings-icon-action"
          onClick={() => onRemove(match.id)}
          title="Excluir snippet"
          aria-label="Excluir snippet"
        >
          <Trash2 size={14} strokeWidth={2} absoluteStrokeWidth />
        </button>
      </div>
    </div>
  );
}

async function emitChanged(settings: TypoFireSettings, matches: TypoFireMatch[]): Promise<void> {
  try {
    await emit("settings://changed", { typoFire: { settings, matches } });
  } catch (err) {
    console.warn("[settings] emit Typo Fire failed:", err);
  }
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function configureEngine(
  settings: TypoFireSettings,
  matches: TypoFireMatch[],
): Promise<TypoFireEngineStatus> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const status = await invoke<TypoFireEngineStatus>("typo_fire_configure", {
        settings,
        matches,
      });
      if (settings.enabled && !status.hookActive) {
        return await invoke<TypoFireEngineStatus>("typo_fire_reload");
      }
      return status;
    } catch (err) {
      lastError = err;
      console.warn("[settings] Typo Fire configure failed:", err);
      if (attempt < 2) await sleep(120);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function splitTriggers(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function ensureTriggerPrefix(trigger: string, prefix: string): string {
  const cleanPrefix = sanitizePrefix(prefix);
  const normalizedTrigger = trigger.replace(/^[^\p{L}\p{N}]+/u, "");
  if (!cleanPrefix) return normalizedTrigger;
  return `${cleanPrefix}${normalizedTrigger}`;
}

function stripTriggerPrefix(trigger: string, prefix: string): string {
  const cleanPrefix = sanitizePrefix(prefix);
  if (cleanPrefix && trigger.startsWith(cleanPrefix)) {
    return trigger.slice(cleanPrefix.length);
  }
  return trigger.replace(/^[^\p{L}\p{N}]+/u, "");
}

function sanitizePrefix(value: string): string {
  return sanitizeTypoFirePrefix(value);
}

function presetTextPreview(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ").slice(0, 96);
}

function makeMatch(draft: MatchDraft, prefix: string): TypoFireMatch | null {
  const textPreset = draft.matchType === "regex" ? draft.matchType : "literal";
  const triggers = splitTriggers(draft.triggers).map((trigger) =>
    textPreset === "regex" ? trigger : ensureTriggerPrefix(trigger, prefix),
  );
  if (!draft.replace.trim() || triggers.length === 0) return null;
  const label =
    textPreset === "regex"
      ? triggers[0]
      : stripTriggerPrefix(triggers[0], prefix);

  return {
    id: draft.id ?? `match-${crypto.randomUUID()}`,
    label,
    triggers,
    replace: draft.replace,
    matchType: textPreset,
    variables: [],
    formFields: [],
    appFilters: {
      mode: "disabled",
      entries: [],
    },
    enabled: draft.enabled,
    favorite: draft.favorite,
  };
}

function matchToDraft(match: TypoFireMatch, prefix: string): MatchDraft {
  return {
    id: match.id,
    label: match.label,
    triggers:
      match.matchType === "regex"
        ? match.triggers.join(", ")
        : match.triggers
            .map((trigger) => stripTriggerPrefix(trigger, prefix))
            .join(", "),
    replace: match.replace,
    matchType: match.matchType,
    enabled: match.enabled,
    favorite: match.favorite,
  };
}

function quoteYaml(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function exportMatches(matches: TypoFireMatch[]): string {
  const lines = ["matches:"];
  for (const match of matches) {
    lines.push(`  - label: ${quoteYaml(match.label)}`);
    lines.push(`    triggers: [${match.triggers.map(quoteYaml).join(", ")}]`);
    lines.push(`    replace: ${quoteYaml(match.replace)}`);
    lines.push(`    matchType: ${quoteYaml(match.matchType)}`);
    lines.push(`    enabled: ${match.enabled ? "true" : "false"}`);
    lines.push(`    favorite: ${match.favorite ? "true" : "false"}`);
  }
  return lines.join("\n");
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function parseTriggers(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map(unquoteYaml)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [unquoteYaml(trimmed)].filter(Boolean);
}

function importMatches(input: string): TypoFireMatch[] {
  const imported: TypoFireMatch[] = [];
  let current: Partial<TypoFireMatch> | null = null;

  const flush = () => {
    if (!current?.replace || !current.triggers?.length) return;
    imported.push({
      id: current.id ?? `match-${crypto.randomUUID()}`,
      label: current.label ?? current.triggers[0],
      triggers: current.triggers,
      replace: current.replace,
      matchType: current.matchType ?? "literal",
      variables: [],
      formFields: [],
      appFilters: {
        mode: "disabled",
        entries: [],
      },
      enabled: current.enabled ?? true,
      favorite: current.favorite ?? false,
    });
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "matches:" || line.startsWith("#")) continue;
    const item = line.startsWith("- ");
    const body = item ? line.slice(2) : line;
    const [rawKey, ...rest] = body.split(":");
    const key = rawKey.trim();
    const value = rest.join(":").trim();
    if (item) {
      flush();
      current = {};
    }
    if (!current) current = {};

    if (key === "label") current.label = unquoteYaml(value);
    if (key === "trigger") current.triggers = [unquoteYaml(value)];
    if (key === "triggers") current.triggers = parseTriggers(value);
    if (key === "replace") current.replace = unquoteYaml(value);
    if (key === "matchType") current.matchType = unquoteYaml(value) === "regex" ? "regex" : "literal";
    if (key === "regex") {
      current.triggers = [unquoteYaml(value)];
      current.matchType = "regex";
    }
    if (key === "enabled") current.enabled = value !== "false";
    if (key === "favorite") current.favorite = value === "true";
  }
  flush();
  return imported;
}

export function SectionTypoFire({ onSaved, onError }: SectionTypoFireProps) {
  const [settings, setSettings] =
    useState<TypoFireSettings>(DEFAULT_TYPO_FIRE_SETTINGS);
  const [matches, setMatches] = useState<TypoFireMatch[]>([]);
  const [draft, setDraft] = useState<MatchDraft>(EMPTY_DRAFT);
  const [yamlText, setYamlText] = useState("");
  const [engineStatus, setEngineStatus] = useState<TypoFireEngineStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loadedSettings, loadedMatches] = await Promise.all([
        loadTypoFireSettings(),
        loadTypoFireMatches(),
      ]);
      if (cancelled) return;
      setSettings(loadedSettings);
      setMatches(loadedMatches);
      setYamlText(exportMatches(loadedMatches));
      await configureEngine(loadedSettings, loadedMatches)
        .then((status) => {
          if (!cancelled) setEngineStatus(status);
        })
        .catch((err) => {
          console.warn("[settings] Typo Fire initial sync failed:", err);
        });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await listen<TypoFireChangedPayload>("settings://changed", (event) => {
        const next = event.payload?.typoFire;
        if (!next) return;
        setSettings(next.settings);
        setMatches(next.matches);
        setYamlText(exportMatches(next.matches));
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const enabledCount = useMemo(
    () => matches.filter((match) => match.enabled).length,
    [matches],
  );
  const hookStatusText = useMemo(() => {
    if (!engineStatus) return "Sincronizando.";
    if (engineStatus.lastError) return "Não consegui ativar o Typo Fire.";
    return engineStatus.hookActive ? "Ativo" : "Pausado";
  }, [engineStatus]);
  const draftPreviewTriggers = useMemo(
    () =>
      splitTriggers(draft.triggers)
        .map((trigger) =>
          draft.matchType === "regex"
            ? trigger
            : ensureTriggerPrefix(trigger, settings.prefix),
        )
        .join(", "),
    [draft.matchType, draft.triggers, settings.prefix],
  );

  const persist = async (
    nextSettings: TypoFireSettings,
    nextMatches: TypoFireMatch[],
    message = "Typo Fire salvo",
  ) => {
    const savedSettings = await saveTypoFireSettings(nextSettings);
    const savedMatches = await saveTypoFireMatches(nextMatches);
    setSettings(savedSettings);
    setMatches(savedMatches);
    setYamlText(exportMatches(savedMatches));
    try {
      const status = await configureEngine(savedSettings, savedMatches);
      setEngineStatus(status);
      await emitChanged(savedSettings, savedMatches);
      onSaved(message);
    } catch (err) {
      console.warn("[settings] Typo Fire sync after save failed:", err);
      onError("Typo Fire: preset salvo, mas a prévia não atualizou. Tentando sincronizar.");
      window.setTimeout(() => {
        void configureEngine(savedSettings, savedMatches)
          .then((status) => setEngineStatus(status))
          .then(() => emitChanged(savedSettings, savedMatches))
          .then(() => onSaved("Typo Fire sincronizado"))
          .catch((retryErr) => {
            console.warn("[settings] Typo Fire retry sync failed:", retryErr);
            onError("Typo Fire: não consegui atualizar a prévia agora. Reinicie o app.");
          });
      }, 300);
    }
  };

  const updateSettings = async (patch: Partial<TypoFireSettings>) => {
    const next = { ...settings, ...patch };
    await persist(next, matches);
  };

  const updatePrefix = async (value: string) => {
    const prefix = sanitizePrefix(value);
    await updateSettings({ prefix });
  };

  const saveDraft = async () => {
    const nextMatch = makeMatch(draft, settings.prefix);
    if (!nextMatch) {
      onError("Typo Fire: informe o atalho e o texto de substituição.");
      return;
    }
    const nextMatches = matches.some((match) => match.id === nextMatch.id)
      ? matches.map((match) => (match.id === nextMatch.id ? nextMatch : match))
      : [nextMatch, ...matches];
    setDraft(EMPTY_DRAFT);
    await persist(settings, nextMatches);
  };

  const removeMatch = async (id: string) => {
    await persist(
      settings,
      matches.filter((match) => match.id !== id),
      "Match removido",
    );
  };

  const toggleMatch = async (id: string, enabled: boolean) => {
    await persist(
      settings,
      matches.map((match) => (match.id === id ? { ...match, enabled } : match)),
    );
  };

  const toggleFavorite = async (id: string, favorite: boolean) => {
    await persist(
      settings,
      matches.map((match) => (match.id === id ? { ...match, favorite } : match)),
      favorite ? "Preset favoritado" : "Favorito removido",
    );
  };

  const handleImport = async () => {
    try {
      const imported = importMatches(yamlText);
      if (imported.length === 0) {
        onError("Typo Fire: nenhum match válido encontrado no YAML.");
        return;
      }
      await persist(settings, imported, "YAML importado");
    } catch (err) {
      onError(userFacingError(err, "Não foi possível importar o YAML."));
    }
  };

  const handleExport = async () => {
    const output = exportMatches(matches);
    setYamlText(output);
    try {
      await navigator.clipboard.writeText(output);
      onSaved("YAML copiado");
    } catch {
      onSaved("YAML gerado");
    }
  };

  const editMatch = (match: TypoFireMatch) => setDraft(matchToDraft(match, settings.prefix));

  return (
    <section className="settings-section typo-fire-section">
      <h2 className="settings-section-title">Typo Fire</h2>
      <p className="settings-section-hint">
        Snippets locais no estilo Text Blaze: digite /oi e o texto salvo entra no lugar.
      </p>

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-label">Ativar Typo Fire</span>
            <span className="settings-row-desc">
              {enabledCount} snippet{enabledCount === 1 ? "" : "s"} ativo
              {enabledCount === 1 ? "" : "s"}. {hookStatusText}
            </span>
          </div>
          <ToggleSwitch
            checked={settings.enabled}
            label={settings.enabled ? "Ativo" : "Pausado"}
            onClick={() => updateSettings({ enabled: !settings.enabled })}
          />
          <Flame size={17} strokeWidth={2} absoluteStrokeWidth />
        </div>

        <div className="settings-row settings-row-stacked">
          <div className="settings-row-text">
            <span className="settings-row-label">Prefixo do Typo Fire</span>
            <span className="settings-row-desc">
              Usado antes do atalho. Exemplo: /oi.
            </span>
          </div>
          <div className="typo-fire-prefix-control" aria-label="Escolha um prefixo">
            <span className="typo-fire-prefix-label">Escolha um prefixo</span>
            <div className="typo-fire-prefix-options">
              {prefixOptions.map((prefix) => (
                <button
                  key={prefix}
                  type="button"
                  className={`typo-fire-prefix-option${
                    settings.prefix === prefix ? " active" : ""
                  }`}
                  onClick={() => updatePrefix(prefix)}
                >
                  {prefix}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-row settings-row-stacked">
          <span className="settings-row-label">Modo de trigger</span>
          <select
            className="settings-select"
            value={settings.triggerMode}
            onChange={(e) =>
              updateSettings({
                triggerMode: e.target.value === "word" ? "word" : "suffix",
              })
            }
          >
            <option value="suffix">Sufixo digitado</option>
            <option value="word">Palavra inteira</option>
          </select>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-label">Undo por backspace</span>
            <span className="settings-row-desc">
              Mantém o comportamento de expansão previsível em apps comuns.
            </span>
          </div>
          <ToggleSwitch
            checked={settings.undoBackspace}
            label={settings.undoBackspace ? "Ativo" : "Pausado"}
            onClick={() => updateSettings({ undoBackspace: !settings.undoBackspace })}
          />
        </div>
      </div>

      <div className="settings-card typo-fire-editor">
        <div className="typo-fire-editor-inner">
          <div className="typo-fire-editor-head">
            <div>
              <span className="settings-row-label">Novo preset de texto</span>
              <span className="settings-row-desc">
                Exemplo: você digita /oi e o app escreve olá, tudo bem?
              </span>
            </div>
          </div>

          <div className="typo-fire-fields">
            <label className="typo-fire-field typo-fire-field-full">
              <span>Atalho que você digita</span>
              <input
                className="settings-input typo-fire-trigger-input"
                value={draft.triggers}
                onChange={(e) => setDraft((prev) => ({ ...prev, triggers: e.target.value }))}
                placeholder="oi"
              />
              {draftPreviewTriggers && (
                <small className="typo-fire-trigger-preview">
                  Vai salvar como <strong>{draftPreviewTriggers}</strong>
                </small>
              )}
            </label>
            <label className="typo-fire-field typo-fire-field-full">
              <span>Texto que aparece</span>
              <textarea
                className="settings-textarea"
                value={draft.replace}
                onChange={(e) => setDraft((prev) => ({ ...prev, replace: e.target.value }))}
                placeholder="olá, tudo bem?"
                rows={3}
              />
            </label>
          </div>

          <div className="settings-row-actions">
            <button type="button" className="settings-action-mini" onClick={saveDraft}>
              <Save size={14} strokeWidth={2} absoluteStrokeWidth />
              Salvar preset
            </button>
            <button
              type="button"
              className="settings-icon-action"
              onClick={() => setDraft(EMPTY_DRAFT)}
              title="Limpar formulário"
              aria-label="Limpar formulário"
            >
              <RotateCcw size={14} strokeWidth={2} absoluteStrokeWidth />
            </button>
          </div>
        </div>
      </div>

      <div className="typo-fire-saved">
        <div className="typo-fire-saved-header">
          <span className="settings-row-label">Presets salvos</span>
          <span className="settings-row-desc">Clique em um preset salvo para alterar.</span>
        </div>
        {matches.length === 0 ? (
          <div className="settings-empty-state">
            <Plus size={16} strokeWidth={2} absoluteStrokeWidth />
            Crie o primeiro snippet, como /oi para olá, tudo bem?
          </div>
        ) : (
          <>
            <div className="typo-fire-preset-bar" aria-label="Presets salvos do Typo Fire">
              {matches.map((match) => (
                <PresetChip
                  key={match.id}
                  match={match}
                  onEdit={editMatch}
                  onFavorite={toggleFavorite}
                  onRemove={removeMatch}
                  onToggle={toggleMatch}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <details className="settings-card typo-fire-yaml">
        <summary className="typo-fire-advanced-summary">Avançado</summary>
        <div className="settings-row settings-row-stacked">
          <div className="typo-fire-help">
            <HelpCircle size={15} strokeWidth={2} absoluteStrokeWidth />
            <div>
              <span className="settings-row-label">Regex e YAML</span>
              <span className="settings-row-desc">
                Regex é para padrões avançados, tipo atalhos que aceitam partes variáveis.
                YAML é um formato de texto para importar ou exportar seus presets.
              </span>
            </div>
          </div>
          <div className="typo-fire-advanced-row">
            <label className="typo-fire-field">
              <span>Tipo de preset</span>
              <select
                className="settings-select"
                value={draft.matchType}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    matchType: e.target.value === "regex" ? "regex" : "literal",
                  }))
                }
              >
                <option value="literal">Texto simples</option>
                <option value="regex">Regex avançado</option>
              </select>
            </label>
          </div>
          <textarea
            className="settings-textarea"
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            rows={5}
          />
          <div className="settings-row-actions">
            <button type="button" className="settings-action-mini" onClick={handleExport}>
              <Save size={14} strokeWidth={2} absoluteStrokeWidth />
              Exportar
            </button>
            <button type="button" className="settings-action-mini" onClick={handleImport}>
              <Import size={14} strokeWidth={2} absoluteStrokeWidth />
              Importar
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
