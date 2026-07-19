import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { disableBrowserDefaults } from "./lib/disable-browser-defaults";
import { loadAppearanceSettings, type AppearanceSettings } from "./lib/app-settings";
import { applyAppearanceSettings } from "./lib/apply-appearance";
import { clearRetiredGoogleBackupData } from "./lib/retired-google-backup";
import "./styles/design-system.css";

const App = React.lazy(() => import("./App"));
const SettingsApp = React.lazy(() => import("./settings/SettingsApp"));
const DownloadsApp = React.lazy(() => import("./downloads/DownloadsApp"));
const MediaMixerApp = React.lazy(() => import("./media-mixer/MediaMixerApp"));
const TypoFirePopup = React.lazy(() => import("./typo-fire-popup/TypoFirePopup"));
const TypoFireApp = React.lazy(() => import("./typo-fire/TypoFireApp"));
const NoteWindow = React.lazy(() => import("./notes/NoteWindow"));
const TodoCalendarApp = React.lazy(() => import("./productivity/TodoCalendarApp"));
const PomodoroApp = React.lazy(() => import("./productivity/PomodoroApp"));
const ProductivityAlertApp = React.lazy(() => import("./productivity/ProductivityAlertApp"));

disableBrowserDefaults();

void clearRetiredGoogleBackupData().catch(() => {});
void loadAppearanceSettings().then(applyAppearanceSettings);
void listen<{ appearance?: AppearanceSettings }>("settings://changed", (event) => {
  if (event.payload?.appearance) applyAppearanceSettings(event.payload.appearance);
});

const isSettingsRoute = window.location.hash.startsWith("#/settings");
const isDownloadsRoute = window.location.hash.startsWith("#/downloads");
const isMediaMixerRoute = window.location.hash.startsWith("#/media-mixer");
const isTypoFirePopupRoute = window.location.hash.startsWith("#/typo-fire-popup");
const isTypoFireRoute = window.location.hash.startsWith("#/typo-fire");
const isNoteRoute = window.location.hash.startsWith("#/note");
const isTodoCalendarRoute = window.location.hash.startsWith("#/todo-calendar");
const isPomodoroRoute = window.location.hash.startsWith("#/pomodoro");
const isProductivityAlertRoute = window.location.hash.startsWith("#/productivity-alert");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {isTypoFirePopupRoute ? (
        <TypoFirePopup />
      ) : isTypoFireRoute ? (
        <TypoFireApp />
      ) : isNoteRoute ? (
        <NoteWindow />
      ) : isProductivityAlertRoute ? (
        <ProductivityAlertApp />
      ) : isTodoCalendarRoute ? (
        <TodoCalendarApp />
      ) : isPomodoroRoute ? (
        <PomodoroApp />
      ) : isDownloadsRoute ? (
        <DownloadsApp />
      ) : isMediaMixerRoute ? (
        <MediaMixerApp />
      ) : isSettingsRoute ? (
        <SettingsApp />
      ) : (
        <App />
      )}
    </Suspense>
  </React.StrictMode>,
);
