import { useEffect, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronRight, Star } from "lucide-react";
import "./TypoFirePopup.css";

interface TypoFireSuggestion {
  matchId: string;
  label: string;
  trigger: string;
  preview: string;
  deleteChars: number;
  favorite: boolean;
}

interface SuggestionPayload {
  prefix: string;
  query: string;
  selectedIndex: number;
  suggestions: TypoFireSuggestion[];
}

export default function TypoFirePopup() {
  const [payload, setPayload] = useState<SuggestionPayload>({
    prefix: "/",
    query: "/",
    selectedIndex: 0,
    suggestions: [],
  });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const receivePayload = (next: SuggestionPayload) => {
    setPayload(next);
    setSelectedIndex(
      next.suggestions.length > 0
        ? Math.min(next.selectedIndex ?? 0, next.suggestions.length - 1)
        : 0,
    );
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const current = await invoke<SuggestionPayload | null>(
        "typo_fire_current_suggestions",
      ).catch(() => null);
      if (current) receivePayload(current);
      unlisten = await listen<SuggestionPayload>(
        "typo-fire://suggestions",
        (event) => receivePayload(event.payload),
      );
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const applySuggestion = async (suggestion: TypoFireSuggestion) => {
    await invoke("typo_fire_apply_suggestion", {
      matchId: suggestion.matchId,
      trigger: suggestion.trigger,
      deleteChars: suggestion.deleteChars,
    }).catch((err) => console.warn("[typo-fire-popup] apply failed:", err));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (payload.suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => (current + 1) % payload.suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) =>
        current === 0 ? payload.suggestions.length - 1 : current - 1,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const suggestion = payload.suggestions[selectedIndex];
      if (suggestion) applySuggestion(suggestion);
    }
  };

  return (
    <main className="typo-fire-popup" tabIndex={0} onKeyDown={handleKeyDown}>
      <header className="typo-fire-popup-header">
        <span>Typo Fire</span>
        <kbd>{payload.query || payload.prefix}</kbd>
      </header>
      <div className="typo-fire-popup-list" role="listbox">
        {payload.suggestions.map((suggestion, index) => (
          <button
            key={`${suggestion.matchId}-${suggestion.trigger}`}
            type="button"
            className={`typo-fire-popup-item${
              index === selectedIndex ? " selected" : ""
            }`}
            title={suggestion.trigger}
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => applySuggestion(suggestion)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="typo-fire-popup-name">
              {suggestion.favorite && (
                <Star size={12} strokeWidth={2} absoluteStrokeWidth fill="currentColor" />
              )}
              {suggestion.label}
            </span>
            <span className="typo-fire-popup-preview">{suggestion.preview}</span>
            <small>{suggestion.trigger}</small>
            <ChevronRight size={14} strokeWidth={2} absoluteStrokeWidth />
          </button>
        ))}
      </div>
    </main>
  );
}
