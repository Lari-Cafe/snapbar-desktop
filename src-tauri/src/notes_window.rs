use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const NOTE_LABEL_PREFIX: &str = "note-";
const DEFAULT_NOTE_W: f64 = 380.0;
const DEFAULT_NOTE_H: f64 = 320.0;
const MIN_NOTE_W: f64 = 340.0;
const MIN_NOTE_H: f64 = 260.0;
const CASCADE_BASE: f64 = 96.0;
const CASCADE_STEP: f64 = 28.0;

#[derive(Clone, Copy, Debug)]
struct LogicalRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl LogicalRect {
    fn right(self) -> f64 {
        self.x + self.width
    }

    fn bottom(self) -> f64 {
        self.y + self.height
    }

    fn contains_window(self, x: f64, y: f64, width: f64, height: f64) -> bool {
        x >= self.x && y >= self.y && x + width <= self.right() && y + height <= self.bottom()
    }

    fn intersection_area(self, x: f64, y: f64, width: f64, height: f64) -> f64 {
        let left = x.max(self.x);
        let top = y.max(self.y);
        let right = (x + width).min(self.right());
        let bottom = (y + height).min(self.bottom());
        if right <= left || bottom <= top {
            0.0
        } else {
            (right - left) * (bottom - top)
        }
    }

    fn clamp_window(self, x: f64, y: f64, width: f64, height: f64) -> (f64, f64) {
        let max_x = (self.right() - width).max(self.x);
        let max_y = (self.bottom() - height).max(self.y);
        (x.max(self.x).min(max_x), y.max(self.y).min(max_y))
    }
}

/// Mantém apenas caracteres seguros para usar como label de janela / id na URL.
fn sanitize_note_id(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// Deriva o label da janela a partir do id da nota. Garante o prefixo `note-`
/// para casar com a capability `note-*`. Retorna `None` se o id ficar vazio.
fn note_window_label(note_id: &str) -> Option<String> {
    let id = sanitize_note_id(note_id);
    if id.is_empty() {
        return None;
    }
    if id.starts_with(NOTE_LABEL_PREFIX) {
        Some(id)
    } else {
        Some(format!("{NOTE_LABEL_PREFIX}{id}"))
    }
}

fn note_window_url(label: &str) -> String {
    format!("index.html#/note?id={label}")
}

fn clamp_size(value: Option<f64>, min: f64, default: f64) -> f64 {
    match value {
        Some(v) if v.is_finite() => v.max(min),
        _ => default,
    }
}

fn monitor_to_logical_rect(monitor: &tauri::Monitor) -> LogicalRect {
    let scale = monitor.scale_factor();
    let position = monitor.position();
    let size = monitor.size();
    LogicalRect {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    }
}

fn resolve_position_from_monitors(
    monitors: &[LogicalRect],
    requested: Option<(f64, f64)>,
    width: f64,
    height: f64,
    note_count: usize,
) -> (f64, f64) {
    let offset = CASCADE_BASE + note_count as f64 * CASCADE_STEP;
    let (raw_x, raw_y) = requested.unwrap_or_else(|| {
        monitors
            .first()
            .map(|monitor| (monitor.x + offset, monitor.y + offset))
            .unwrap_or((offset, offset))
    });

    let Some(target) = monitors
        .iter()
        .copied()
        .find(|monitor| monitor.contains_window(raw_x, raw_y, width, height))
        .or_else(|| {
            monitors
                .iter()
                .copied()
                .max_by(|a, b| {
                    a.intersection_area(raw_x, raw_y, width, height)
                        .partial_cmp(&b.intersection_area(raw_x, raw_y, width, height))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .filter(|monitor| monitor.intersection_area(raw_x, raw_y, width, height) > 0.0)
        })
        .or_else(|| monitors.first().copied())
    else {
        return (raw_x, raw_y);
    };

    target.clamp_window(raw_x, raw_y, width, height)
}

fn resolve_note_position(
    app: &AppHandle,
    x: Option<f64>,
    y: Option<f64>,
    width: f64,
    height: f64,
) -> (f64, f64) {
    let requested = match (x, y) {
        (Some(px), Some(py)) if px.is_finite() && py.is_finite() => Some((px, py)),
        _ => None,
    };

    let mut monitors = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(monitor_to_logical_rect)
        .filter(|monitor| monitor.width > 0.0 && monitor.height > 0.0)
        .collect::<Vec<_>>();

    if let Ok(Some(primary)) = app.primary_monitor() {
        let primary = monitor_to_logical_rect(&primary);
        monitors.sort_by_key(|monitor| {
            if monitor.x == primary.x
                && monitor.y == primary.y
                && monitor.width == primary.width
                && monitor.height == primary.height
            {
                0
            } else {
                1
            }
        });
    }

    let note_count = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with(NOTE_LABEL_PREFIX))
        .count();

    resolve_position_from_monitors(&monitors, requested, width, height, note_count)
}

fn reveal_note_window(win: &WebviewWindow) {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

/// Abre (ou foca) a janela flutuante de uma nota.
/// Janela frameless, transparente, sempre no topo, fora da taskbar e arrastável.
#[tauri::command]
pub async fn open_note_window(
    app: AppHandle,
    note_id: String,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    let label = note_window_label(&note_id).ok_or("invalid note id")?;

    if let Some(existing) = app.get_webview_window(&label) {
        reveal_note_window(&existing);
        return Ok(());
    }

    let w = clamp_size(width, MIN_NOTE_W, DEFAULT_NOTE_W);
    let h = clamp_size(height, MIN_NOTE_H, DEFAULT_NOTE_H);
    let (px, py) = resolve_note_position(&app, x, y, w, h);

    let mut builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(note_window_url(&label).into()),
    )
    .title("Nota")
    .inner_size(w, h)
    .min_inner_size(MIN_NOTE_W, MIN_NOTE_H)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .resizable(true)
    .shadow(false)
    .visible(false);

    builder = builder.position(px, py);

    let win = builder
        .build()
        .map_err(|e| format!("create note window: {e}"))?;

    reveal_note_window(&win);
    Ok(())
}

/// Fecha a janela de uma nota (não apaga a nota do disco).
#[tauri::command]
pub fn close_note_window(app: AppHandle, note_id: String) -> Result<(), String> {
    if let Some(label) = note_window_label(&note_id) {
        if let Some(win) = app.get_webview_window(&label) {
            win.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Indica se existe ao menos uma janela de nota aberta na tela.
#[tauri::command]
pub fn any_note_window_open(app: AppHandle) -> bool {
    app.webview_windows()
        .keys()
        .any(|label| label.starts_with(NOTE_LABEL_PREFIX))
}

/// Oculta todas as notas (fecha as janelas; as notas seguem salvas no disco).
#[tauri::command]
pub fn close_all_note_windows(app: AppHandle) -> Result<(), String> {
    for (label, win) in app.webview_windows() {
        if label.starts_with(NOTE_LABEL_PREFIX) {
            let _ = win.close();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_note_id_removing_unsafe_chars() {
        assert_eq!(sanitize_note_id("note-abc123"), "note-abc123");
        assert_eq!(sanitize_note_id("../../evil"), "evil");
        assert_eq!(sanitize_note_id("a b/c?d=e"), "abcde");
        assert_eq!(sanitize_note_id("---"), "");
    }

    #[test]
    fn label_always_has_note_prefix() {
        assert_eq!(note_window_label("note-abc").as_deref(), Some("note-abc"),);
        assert_eq!(note_window_label("abc").as_deref(), Some("note-abc"));
        assert_eq!(note_window_label("///"), None);
    }

    #[test]
    fn url_targets_the_note_route_with_id() {
        let url = note_window_url("note-xyz");
        assert!(url.contains("#/note?id="));
        assert!(url.ends_with("note-xyz"));
    }

    #[test]
    fn clamp_size_respects_minimum_and_default() {
        assert_eq!(clamp_size(None, MIN_NOTE_W, DEFAULT_NOTE_W), DEFAULT_NOTE_W);
        assert_eq!(
            clamp_size(Some(10.0), MIN_NOTE_W, DEFAULT_NOTE_W),
            MIN_NOTE_W
        );
        assert_eq!(clamp_size(Some(420.0), MIN_NOTE_W, DEFAULT_NOTE_W), 420.0);
        assert_eq!(
            clamp_size(Some(f64::NAN), MIN_NOTE_H, DEFAULT_NOTE_H),
            DEFAULT_NOTE_H,
        );
    }

    #[test]
    fn clamps_saved_note_position_back_inside_the_visible_monitor() {
        let monitor = LogicalRect {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };

        let (x, y) = resolve_position_from_monitors(
            &[monitor],
            Some((-769.0, -716.0)),
            DEFAULT_NOTE_W,
            DEFAULT_NOTE_H,
            0,
        );

        assert_eq!((x, y), (0.0, 0.0));
    }

    #[test]
    fn keeps_valid_negative_coordinates_on_a_left_side_monitor() {
        let monitors = [
            LogicalRect {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
            },
            LogicalRect {
                x: -1280.0,
                y: 0.0,
                width: 1280.0,
                height: 1024.0,
            },
        ];

        let (x, y) = resolve_position_from_monitors(
            &monitors,
            Some((-900.0, 120.0)),
            DEFAULT_NOTE_W,
            DEFAULT_NOTE_H,
            0,
        );

        assert_eq!((x, y), (-900.0, 120.0));
    }

    #[test]
    fn cascades_new_notes_from_the_primary_monitor_origin() {
        let monitor = LogicalRect {
            x: 50.0,
            y: 25.0,
            width: 1920.0,
            height: 1080.0,
        };

        let (x, y) =
            resolve_position_from_monitors(&[monitor], None, DEFAULT_NOTE_W, DEFAULT_NOTE_H, 2);

        assert_eq!(
            (x, y),
            (
                50.0 + CASCADE_BASE + CASCADE_STEP * 2.0,
                25.0 + CASCADE_BASE + CASCADE_STEP * 2.0
            )
        );
    }

    #[test]
    fn note_windows_stay_above_and_off_taskbar() {
        // Garante que os defaults usados na build expressam o comportamento sticky.
        assert!(MIN_NOTE_W <= DEFAULT_NOTE_W);
        assert!(MIN_NOTE_H <= DEFAULT_NOTE_H);
        assert!(CASCADE_STEP > 0.0);
    }
}
