use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const DOWNLOADS_LABEL: &str = "downloads";
const DOWNLOADS_URL: &str = "index.html#/downloads";
const DOWNLOADS_W: f64 = 820.0;
const DOWNLOADS_H: f64 = 560.0;
const DOWNLOAD_EVENT: &str = "downloads://job";
const PROGRESS_PREFIX: &str = "snapbar:download|";

#[derive(Clone, Default)]
pub struct InternetDownloadState {
    current: Arc<Mutex<Option<InternetDownloadProcess>>>,
    next_id: Arc<AtomicU64>,
}

#[derive(Clone)]
struct InternetDownloadProcess {
    id: String,
    child: Arc<Mutex<Option<Child>>>,
    cancelled: Arc<AtomicBool>,
    output_path: PathBuf,
    output_dir: PathBuf,
    output_stem: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InternetDownloadOptions {
    pub format: DownloadFormat,
    pub video_quality: Option<VideoQualityPreset>,
    pub audio_quality_kbps: Option<u16>,
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum DownloadFormat {
    #[serde(rename = "mp4")]
    Mp4,
    #[serde(rename = "mp3")]
    Mp3,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum VideoQualityPreset {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "1080p")]
    P1080,
    #[serde(rename = "720p")]
    P720,
    #[serde(rename = "480p")]
    P480,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InternetDownloadProbeResult {
    pub title: String,
    pub source: String,
    pub duration_seconds: Option<f64>,
    pub thumbnail: Option<String>,
    pub available_video_qualities: Vec<VideoQualityPreset>,
    pub hardware_acceleration: HardwareAcceleration,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJobSnapshot {
    pub id: String,
    pub url: String,
    pub title: String,
    pub status: DownloadJobStatus,
    pub progress_percent: Option<f64>,
    pub speed: Option<String>,
    pub stage: String,
    pub output_path: Option<String>,
    pub message: Option<String>,
    pub hardware_acceleration: HardwareAcceleration,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum DownloadJobStatus {
    Queued,
    Probing,
    Downloading,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HardwareAcceleration {
    Gpu,
    Cpu,
}

#[derive(Debug, Clone, PartialEq)]
struct ProgressUpdate {
    progress_percent: Option<f64>,
    speed: Option<String>,
    stage: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DownloadAttemptKind {
    Primary,
    ConservativeFallback,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DownloadAttemptOutcome {
    Success,
    Cancelled,
    Failed(String),
}

#[tauri::command]
pub async fn open_downloads_window(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(DOWNLOADS_LABEL) {
        reveal_downloads_window(&existing);
        return Ok(());
    }

    let win =
        WebviewWindowBuilder::new(&app, DOWNLOADS_LABEL, WebviewUrl::App(DOWNLOADS_URL.into()))
            .title("Downloads")
            .inner_size(DOWNLOADS_W, DOWNLOADS_H)
            .min_inner_size(720.0, 480.0)
            .decorations(false)
            .transparent(true)
            .skip_taskbar(true)
            .center()
            .always_on_top(true)
            .resizable(true)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(|e| format!("create downloads window: {e}"))?;

    reveal_downloads_window(&win);
    Ok(())
}

#[tauri::command]
pub async fn internet_download_probe(
    app: AppHandle,
    url: String,
) -> Result<InternetDownloadProbeResult, String> {
    tauri::async_runtime::spawn_blocking(move || internet_download_probe_blocking(app, url))
        .await
        .map_err(|e| format!("download probe worker: {e}"))?
}

#[tauri::command]
pub async fn internet_download_start(
    app: AppHandle,
    state: tauri::State<'_, InternetDownloadState>,
    url: String,
    options: InternetDownloadOptions,
    title: Option<String>,
) -> Result<DownloadJobSnapshot, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        internet_download_start_blocking(app, state, url, options, title)
    })
    .await
    .map_err(|e| format!("download start worker: {e}"))?
}

#[tauri::command]
pub fn internet_download_cancel(
    state: tauri::State<'_, InternetDownloadState>,
    id: String,
) -> Result<DownloadJobSnapshot, String> {
    let process = {
        let mut guard = state
            .current
            .lock()
            .map_err(|_| "Nao foi possivel cancelar o download agora.".to_string())?;
        if guard.as_ref().map(|process| process.id.as_str()) != Some(id.as_str()) {
            return Err("Este download ja terminou.".to_string());
        }
        guard.take().expect("checked above")
    };

    process.cancelled.store(true, Ordering::SeqCst);
    if let Ok(mut child_guard) = process.child.lock() {
        if let Some(child) = child_guard.as_mut() {
            let _ = child.kill();
        }
    }
    cleanup_partial_download(&process);

    Ok(DownloadJobSnapshot {
        id,
        url: String::new(),
        title: String::new(),
        status: DownloadJobStatus::Cancelled,
        progress_percent: Some(0.0),
        speed: None,
        stage: "Cancelado".to_string(),
        output_path: None,
        message: Some("Download cancelado.".to_string()),
        hardware_acceleration: HardwareAcceleration::Cpu,
    })
}

fn reveal_downloads_window(win: &WebviewWindow) {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

fn internet_download_probe_blocking(
    app: AppHandle,
    url: String,
) -> Result<InternetDownloadProbeResult, String> {
    let url = validate_download_url(&url)?;
    crate::runtime_assets::ensure_feature_available(
        &app,
        crate::runtime_assets::RuntimeFeature::InternetDownloads,
    )?;
    let ytdlp_path =
        crate::tool_paths::resolve_required_tool_path(Some(&app), "yt-dlp", "Downloads")?;
    let deno_path = crate::tool_paths::resolve_required_tool_path(Some(&app), "deno", "Downloads")?;
    let ffmpeg_path =
        crate::tool_paths::resolve_required_tool_path(Some(&app), "ffmpeg", "Downloads")?;
    let output = ytdlp_command(&ytdlp_path, &deno_path)
        .args(build_ytdlp_probe_args(&url))
        .output()
        .map_err(|_| "Nao consegui analisar este link.".to_string())?;

    if !output.status.success() {
        return Err(download_error_from_output(
            &output.stderr,
            "Nao consegui analisar este link. Verifique se ele e publico e tente novamente.",
        ));
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "Nao consegui entender as opcoes deste video.".to_string())?;
    let title = json
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Video")
        .to_string();
    let source = json
        .get("extractor_key")
        .or_else(|| json.get("extractor"))
        .and_then(Value::as_str)
        .unwrap_or("Site")
        .to_string();
    let duration_seconds = json.get("duration").and_then(Value::as_f64);
    let thumbnail = json
        .get("thumbnail")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    Ok(InternetDownloadProbeResult {
        title,
        source,
        duration_seconds,
        thumbnail,
        available_video_qualities: available_video_qualities(&json),
        hardware_acceleration: detect_hardware_acceleration(&ffmpeg_path),
        message: None,
    })
}

fn internet_download_start_blocking(
    app: AppHandle,
    state: InternetDownloadState,
    url: String,
    options: InternetDownloadOptions,
    title: Option<String>,
) -> Result<DownloadJobSnapshot, String> {
    let url = validate_download_url(&url)?;
    crate::runtime_assets::ensure_feature_available(
        &app,
        crate::runtime_assets::RuntimeFeature::InternetDownloads,
    )?;
    {
        let guard = state
            .current
            .lock()
            .map_err(|_| "Nao foi possivel iniciar o download agora.".to_string())?;
        if guard.is_some() {
            return Err(
                "Ja existe um download em andamento. Aguarde terminar ou cancele.".to_string(),
            );
        }
    }

    let ytdlp_path =
        crate::tool_paths::resolve_required_tool_path(Some(&app), "yt-dlp", "Downloads")?;
    let deno_path = crate::tool_paths::resolve_required_tool_path(Some(&app), "deno", "Downloads")?;
    let ffmpeg_path =
        crate::tool_paths::resolve_required_tool_path(Some(&app), "ffmpeg", "Downloads")?;
    let ffprobe_path =
        crate::tool_paths::resolve_required_tool_path(Some(&app), "ffprobe", "Downloads")?;
    let output_dir = download_output_dir(options.output_dir.as_deref())?;
    fs::create_dir_all(&output_dir).map_err(|_| {
        "Nao consegui acessar a pasta escolhida. Escolha outra pasta e tente novamente.".to_string()
    })?;

    let title = title
        .as_deref()
        .map(sanitize_filename)
        .filter(|value| value != "download")
        .unwrap_or_else(|| "video".to_string());
    let extension = match options.format {
        DownloadFormat::Mp4 => "mp4",
        DownloadFormat::Mp3 => "mp3",
    };
    let output_path = unique_output_path(&output_dir, &title, extension);
    let output_filename = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download.mp4")
        .to_string();
    let output_stem = output_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download")
        .to_string();
    let hardware_acceleration = detect_hardware_acceleration(&ffmpeg_path);
    let child_slot = Arc::new(Mutex::new(None));
    let cancelled = Arc::new(AtomicBool::new(false));
    let id = format!(
        "download-{}",
        state.next_id.fetch_add(1, Ordering::SeqCst) + 1
    );
    let process = InternetDownloadProcess {
        id: id.clone(),
        child: Arc::clone(&child_slot),
        cancelled: Arc::clone(&cancelled),
        output_path: output_path.clone(),
        output_dir: output_dir.clone(),
        output_stem: output_stem.clone(),
    };

    {
        let mut guard = state
            .current
            .lock()
            .map_err(|_| "Nao foi possivel registrar o download.".to_string())?;
        *guard = Some(process.clone());
    }

    let snapshot = DownloadJobSnapshot {
        id: id.clone(),
        url: url.clone(),
        title: title.clone(),
        status: DownloadJobStatus::Downloading,
        progress_percent: Some(0.0),
        speed: None,
        stage: "Baixando".to_string(),
        output_path: None,
        message: None,
        hardware_acceleration,
    };
    let _ = app.emit(DOWNLOAD_EVENT, &snapshot);

    std::thread::spawn(move || {
        run_download_worker(
            app,
            state,
            process,
            url,
            title,
            hardware_acceleration,
            extension.to_string(),
            ytdlp_path,
            deno_path,
            ffmpeg_path,
            ffprobe_path,
            options,
            output_filename,
        );
    });

    Ok(snapshot)
}

fn run_download_worker(
    app: AppHandle,
    state: InternetDownloadState,
    process: InternetDownloadProcess,
    url: String,
    title: String,
    hardware_acceleration: HardwareAcceleration,
    expected_extension: String,
    ytdlp_path: PathBuf,
    deno_path: PathBuf,
    ffmpeg_path: PathBuf,
    ffprobe_path: PathBuf,
    options: InternetDownloadOptions,
    output_filename: String,
) {
    let primary_args = build_ytdlp_download_args(
        &ytdlp_path,
        &deno_path,
        &ffmpeg_path,
        &process.output_dir,
        &url,
        &options,
        &output_filename,
        DownloadAttemptKind::Primary,
    );
    let primary = run_download_attempt(
        &app,
        &process,
        &url,
        &title,
        hardware_acceleration,
        &ytdlp_path,
        &deno_path,
        primary_args,
    )
    .unwrap_or_else(DownloadAttemptOutcome::Failed);

    match primary {
        DownloadAttemptOutcome::Success => {
            finish_successful_download(
                &app,
                &state,
                &process,
                &url,
                &title,
                hardware_acceleration,
                &expected_extension,
                &ffmpeg_path,
                &ffprobe_path,
            );
        }
        DownloadAttemptOutcome::Cancelled => {
            cancel_download(&app, &state, &process, &url, &title, hardware_acceleration);
        }
        DownloadAttemptOutcome::Failed(error)
            if should_retry_with_conservative_fallback(&error) =>
        {
            cleanup_partial_download(&process);
            emit_retry_download(&app, &process, &url, &title, hardware_acceleration);
            let fallback_args = build_ytdlp_download_args(
                &ytdlp_path,
                &deno_path,
                &ffmpeg_path,
                &process.output_dir,
                &url,
                &options,
                &output_filename,
                DownloadAttemptKind::ConservativeFallback,
            );
            let fallback = run_download_attempt(
                &app,
                &process,
                &url,
                &title,
                hardware_acceleration,
                &ytdlp_path,
                &deno_path,
                fallback_args,
            )
            .unwrap_or_else(DownloadAttemptOutcome::Failed);
            match fallback {
                DownloadAttemptOutcome::Success => finish_successful_download(
                    &app,
                    &state,
                    &process,
                    &url,
                    &title,
                    hardware_acceleration,
                    &expected_extension,
                    &ffmpeg_path,
                    &ffprobe_path,
                ),
                DownloadAttemptOutcome::Cancelled => {
                    cancel_download(&app, &state, &process, &url, &title, hardware_acceleration);
                }
                DownloadAttemptOutcome::Failed(error) => fail_download(
                    &app,
                    &state,
                    &process,
                    &url,
                    &title,
                    &error,
                    hardware_acceleration,
                ),
            }
        }
        DownloadAttemptOutcome::Failed(error) => fail_download(
            &app,
            &state,
            &process,
            &url,
            &title,
            &error,
            hardware_acceleration,
        ),
    }
}

fn run_download_attempt(
    app: &AppHandle,
    process: &InternetDownloadProcess,
    url: &str,
    title: &str,
    hardware_acceleration: HardwareAcceleration,
    ytdlp_path: &Path,
    deno_path: &Path,
    args: Vec<String>,
) -> Result<DownloadAttemptOutcome, String> {
    let mut child = ytdlp_command(ytdlp_path, deno_path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Nao consegui iniciar o download.".to_string())?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    {
        let mut guard = process
            .child
            .lock()
            .map_err(|_| "Nao foi possivel acompanhar o download.".to_string())?;
        *guard = Some(child);
    }

    let (line_tx, line_rx) = mpsc::channel::<String>();
    if let Some(stdout) = stdout {
        spawn_line_reader(stdout, line_tx.clone());
    }
    let stderr_tail = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = stderr {
        spawn_stderr_reader(stderr, Arc::clone(&stderr_tail));
    }

    let mut last_progress = Some(0.0);
    loop {
        while let Ok(line) = line_rx.try_recv() {
            if let Some(progress) = parse_progress_line(&line) {
                last_progress = progress.progress_percent.or(last_progress);
                let _ = app.emit(
                    DOWNLOAD_EVENT,
                    &DownloadJobSnapshot {
                        id: process.id.clone(),
                        url: url.to_string(),
                        title: title.to_string(),
                        status: DownloadJobStatus::Downloading,
                        progress_percent: last_progress,
                        speed: progress.speed,
                        stage: progress.stage,
                        output_path: None,
                        message: None,
                        hardware_acceleration,
                    },
                );
            }
        }

        let status = {
            let mut guard = match process.child.lock() {
                Ok(guard) => guard,
                Err(_) => {
                    return Ok(DownloadAttemptOutcome::Failed(
                        "Nao foi possivel acompanhar o download.".to_string(),
                    ))
                }
            };
            guard
                .as_mut()
                .and_then(|child| child.try_wait().ok())
                .flatten()
        };

        if let Some(status) = status {
            let mut guard = process.child.lock().ok();
            if let Some(guard) = guard.as_mut() {
                let _ = guard.take();
            }

            if process.cancelled.load(Ordering::SeqCst) {
                return Ok(DownloadAttemptOutcome::Cancelled);
            } else if status.success() {
                return Ok(DownloadAttemptOutcome::Success);
            } else {
                let error = stderr_tail
                    .lock()
                    .ok()
                    .map(|text| text.clone())
                    .unwrap_or_default();
                return Ok(DownloadAttemptOutcome::Failed(error));
            }
        }

        if process.cancelled.load(Ordering::SeqCst) {
            if let Ok(mut guard) = process.child.lock() {
                if let Some(child) = guard.as_mut() {
                    let _ = child.kill();
                }
                let _ = guard.take();
            }
            return Ok(DownloadAttemptOutcome::Cancelled);
        }

        std::thread::sleep(Duration::from_millis(150));
    }
}

fn emit_retry_download(
    app: &AppHandle,
    process: &InternetDownloadProcess,
    url: &str,
    title: &str,
    hardware_acceleration: HardwareAcceleration,
) {
    let _ = app.emit(
        DOWNLOAD_EVENT,
        &DownloadJobSnapshot {
            id: process.id.clone(),
            url: url.to_string(),
            title: title.to_string(),
            status: DownloadJobStatus::Downloading,
            progress_percent: Some(0.0),
            speed: None,
            stage: "Tentando modo compativel".to_string(),
            output_path: None,
            message: Some(
                "A primeira tentativa falhou; o Snapbar esta tentando de novo.".to_string(),
            ),
            hardware_acceleration,
        },
    );
}

fn finish_successful_download(
    app: &AppHandle,
    state: &InternetDownloadState,
    process: &InternetDownloadProcess,
    url: &str,
    title: &str,
    hardware_acceleration: HardwareAcceleration,
    expected_extension: &str,
    ffmpeg_path: &Path,
    ffprobe_path: &Path,
) {
    let mut final_path = resolve_completed_output_path(
        &process.output_path,
        &process.output_dir,
        &process.output_stem,
        expected_extension,
    );
    if expected_extension.eq_ignore_ascii_case("mp4") {
        let _ = app.emit(
            DOWNLOAD_EVENT,
            &DownloadJobSnapshot {
                id: process.id.clone(),
                url: url.to_string(),
                title: title.to_string(),
                status: DownloadJobStatus::Processing,
                progress_percent: Some(100.0),
                speed: None,
                stage: "Finalizando MP4".to_string(),
                output_path: None,
                message: None,
                hardware_acceleration,
            },
        );
        final_path =
            finalize_mp4_output(ffmpeg_path, ffprobe_path, &final_path, &process.output_path);
    }
    if !final_path.is_file() {
        emit_terminal_download(
            app,
            state,
            process,
            url,
            title,
            DownloadJobStatus::Failed,
            None,
            Some(
                "O download terminou, mas o arquivo final nao foi encontrado. Tente novamente."
                    .to_string(),
            ),
            hardware_acceleration,
        );
        return;
    }
    emit_terminal_download(
        app,
        state,
        process,
        url,
        title,
        DownloadJobStatus::Completed,
        Some(final_path.clone()),
        Some(format!("Salvo em: {}", final_path.to_string_lossy())),
        hardware_acceleration,
    );
}

fn cancel_download(
    app: &AppHandle,
    state: &InternetDownloadState,
    process: &InternetDownloadProcess,
    url: &str,
    title: &str,
    hardware_acceleration: HardwareAcceleration,
) {
    cleanup_partial_download(process);
    emit_terminal_download(
        app,
        state,
        process,
        url,
        title,
        DownloadJobStatus::Cancelled,
        None,
        Some("Download cancelado.".to_string()),
        hardware_acceleration,
    );
}

fn fail_download(
    app: &AppHandle,
    state: &InternetDownloadState,
    process: &InternetDownloadProcess,
    url: &str,
    title: &str,
    error: &str,
    hardware_acceleration: HardwareAcceleration,
) {
    cleanup_partial_download(process);
    emit_terminal_download(
        app,
        state,
        process,
        url,
        title,
        DownloadJobStatus::Failed,
        None,
        Some(download_error_message(error.as_bytes())),
        hardware_acceleration,
    );
}

fn emit_terminal_download(
    app: &AppHandle,
    state: &InternetDownloadState,
    process: &InternetDownloadProcess,
    url: &str,
    title: &str,
    status: DownloadJobStatus,
    output_path: Option<PathBuf>,
    message: Option<String>,
    hardware_acceleration: HardwareAcceleration,
) {
    if let Ok(mut guard) = state.current.lock() {
        if guard.as_ref().map(|current| current.id.as_str()) == Some(process.id.as_str()) {
            let _ = guard.take();
        }
    }

    let _ = app.emit(
        DOWNLOAD_EVENT,
        &DownloadJobSnapshot {
            id: process.id.clone(),
            url: url.to_string(),
            title: title.to_string(),
            status,
            progress_percent: if status == DownloadJobStatus::Completed {
                Some(100.0)
            } else {
                None
            },
            speed: None,
            stage: match status {
                DownloadJobStatus::Completed => "Concluido".to_string(),
                DownloadJobStatus::Cancelled => "Cancelado".to_string(),
                DownloadJobStatus::Failed => "Falhou".to_string(),
                _ => "Processando".to_string(),
            },
            output_path: output_path.map(|path| path.to_string_lossy().into_owned()),
            message,
            hardware_acceleration,
        },
    );
}

fn spawn_line_reader<R>(reader: R, tx: mpsc::Sender<String>)
where
    R: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines().map_while(Result::ok) {
            let _ = tx.send(line);
        }
    });
}

fn spawn_stderr_reader<R>(reader: R, tail: Arc<Mutex<String>>)
where
    R: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(mut value) = tail.lock() {
                value.push_str(&line);
                value.push('\n');
                if value.len() > 4096 {
                    let keep_from = value.len().saturating_sub(4096);
                    *value = value[keep_from..].to_string();
                }
            }
        }
    });
}

fn validate_download_url(value: &str) -> Result<String, String> {
    let url = value.trim();
    let lower = url.to_ascii_lowercase();
    if (lower.starts_with("https://") || lower.starts_with("http://"))
        && !url.chars().any(char::is_control)
    {
        Ok(url.to_string())
    } else {
        Err("Use um link publico que comece com http ou https.".to_string())
    }
}

fn sanitize_filename(value: &str) -> String {
    let mut sanitized = String::new();
    let mut last_was_space = false;
    for ch in value.trim().chars() {
        let replacement = if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            || ch.is_control()
        {
            ' '
        } else {
            ch
        };
        if replacement.is_whitespace() {
            if !last_was_space {
                sanitized.push(' ');
                last_was_space = true;
            }
        } else {
            sanitized.push(replacement);
            last_was_space = false;
        }
    }
    let sanitized = sanitized.trim().trim_matches('.').to_string();
    if sanitized.is_empty() {
        "download".to_string()
    } else {
        sanitized.chars().take(96).collect()
    }
}

fn build_ytdlp_probe_args(url: &str) -> Vec<String> {
    vec![
        "--dump-single-json".to_string(),
        "--no-playlist".to_string(),
        "--ignore-config".to_string(),
        "--no-warnings".to_string(),
        "--js-runtimes".to_string(),
        "deno".to_string(),
        url.to_string(),
    ]
}

fn build_ytdlp_download_args(
    _ytdlp_path: &Path,
    deno_path: &Path,
    ffmpeg_path: &Path,
    output_dir: &Path,
    url: &str,
    options: &InternetDownloadOptions,
    filename: &str,
    attempt: DownloadAttemptKind,
) -> Vec<String> {
    let output_stem = Path::new(filename)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let output_template = output_dir.join(format!("{output_stem}.%(ext)s"));
    let ffmpeg_location = ffmpeg_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_string_lossy()
        .into_owned();
    let (http_retry_sleep, fragment_retry_sleep) = match attempt {
        DownloadAttemptKind::Primary => ("http:exp=1:20", "fragment:exp=1:20"),
        DownloadAttemptKind::ConservativeFallback => {
            ("http:linear=2:10:2", "fragment:linear=2:10:2")
        }
    };

    let mut args = vec![
        "--no-playlist".to_string(),
        "--ignore-config".to_string(),
        "--newline".to_string(),
        "--js-runtimes".to_string(),
        ytdlp_deno_runtime_arg(deno_path),
        "--continue".to_string(),
        "--retries".to_string(),
        "10".to_string(),
        "--fragment-retries".to_string(),
        "10".to_string(),
        "--file-access-retries".to_string(),
        "5".to_string(),
        "--retry-sleep".to_string(),
        http_retry_sleep.to_string(),
        "--retry-sleep".to_string(),
        fragment_retry_sleep.to_string(),
        "--socket-timeout".to_string(),
        "30".to_string(),
        "--progress-template".to_string(),
        format!("{PROGRESS_PREFIX}%(progress._percent_str)s|%(progress._speed_str)s|Baixando"),
        "--ffmpeg-location".to_string(),
        ffmpeg_location,
        "-o".to_string(),
        output_template.to_string_lossy().into_owned(),
    ];

    if attempt == DownloadAttemptKind::ConservativeFallback {
        args.extend([
            "--force-ipv4".to_string(),
            "--concurrent-fragments".to_string(),
            "1".to_string(),
            "--extractor-args".to_string(),
            "youtube:player_client=android,web".to_string(),
        ]);
    }

    match options.format {
        DownloadFormat::Mp4 => {
            let quality = options.video_quality.unwrap_or(VideoQualityPreset::Auto);
            let selector = match attempt {
                DownloadAttemptKind::Primary => video_format_selector(quality),
                DownloadAttemptKind::ConservativeFallback => {
                    fallback_video_format_selector(quality)
                }
            };
            args.extend([
                "-f".to_string(),
                selector,
                "--merge-output-format".to_string(),
                "mp4".to_string(),
                "--recode-video".to_string(),
                "mp4".to_string(),
            ]);
        }
        DownloadFormat::Mp3 => {
            let selector = match attempt {
                DownloadAttemptKind::Primary => "ba/b",
                DownloadAttemptKind::ConservativeFallback => "bestaudio[ext=m4a]/bestaudio/b",
            };
            args.extend([
                "-f".to_string(),
                selector.to_string(),
                "--extract-audio".to_string(),
                "--audio-format".to_string(),
                "mp3".to_string(),
                "--audio-quality".to_string(),
                format!("{}K", normalized_audio_quality(options.audio_quality_kbps)),
            ]);
        }
    }

    args.push(url.to_string());
    args
}

fn video_format_selector(preset: VideoQualityPreset) -> String {
    match preset {
        VideoQualityPreset::Auto => {
            "bv*[vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b".to_string()
        }
        VideoQualityPreset::P1080 => {
            "bv*[height<=1080][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]".to_string()
        }
        VideoQualityPreset::P720 => {
            "bv*[height<=720][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]".to_string()
        }
        VideoQualityPreset::P480 => {
            "bv*[height<=480][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/bv*[height<=480][ext=mp4]+ba[ext=m4a]/bv*[height<=480]+ba/b[height<=480]".to_string()
        }
    }
}

fn fallback_video_format_selector(preset: VideoQualityPreset) -> String {
    match preset {
        VideoQualityPreset::Auto => "bv*+ba/b".to_string(),
        VideoQualityPreset::P1080 => {
            "bv*[height<=1080]+ba/b[height<=1080]/best[height<=1080]".to_string()
        }
        VideoQualityPreset::P720 => {
            "bv*[height<=720]+ba/b[height<=720]/best[height<=720]".to_string()
        }
        VideoQualityPreset::P480 => {
            "bv*[height<=480]+ba/b[height<=480]/best[height<=480]".to_string()
        }
    }
}

fn normalized_audio_quality(value: Option<u16>) -> u16 {
    match value {
        Some(128) => 128,
        Some(320) => 320,
        _ => 192,
    }
}

fn ytdlp_deno_runtime_arg(deno_path: &Path) -> String {
    format!("deno:{}", deno_path.to_string_lossy())
}

fn parse_progress_line(line: &str) -> Option<ProgressUpdate> {
    let payload = line.strip_prefix(PROGRESS_PREFIX)?;
    let mut parts = payload.splitn(3, '|');
    let percent = parts.next().unwrap_or("").trim().trim_end_matches('%');
    let speed = parts.next().unwrap_or("").trim();
    let stage = parts.next().unwrap_or("").trim();
    let progress_percent = percent.parse::<f64>().ok();
    Some(ProgressUpdate {
        progress_percent,
        speed: if speed.is_empty() || speed == "NA" {
            None
        } else {
            Some(speed.to_string())
        },
        stage: if stage.is_empty() {
            "Baixando".to_string()
        } else {
            stage.to_string()
        },
    })
}

fn ensure_windows_compatible_mp4(ffmpeg_path: &Path, ffprobe_path: &Path, path: &Path) -> PathBuf {
    if !mp4_needs_compatibility_pass(ffprobe_path, path) {
        return path.to_path_buf();
    }
    transcode_windows_compatible_mp4(ffmpeg_path, path).unwrap_or_else(|_| path.to_path_buf())
}

fn finalize_mp4_output(
    ffmpeg_path: &Path,
    ffprobe_path: &Path,
    actual_path: &Path,
    expected_path: &Path,
) -> PathBuf {
    if !actual_path.is_file() {
        return expected_path.to_path_buf();
    }
    if actual_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
    {
        return ensure_windows_compatible_mp4(ffmpeg_path, ffprobe_path, actual_path);
    }
    transcode_to_windows_compatible_mp4(ffmpeg_path, actual_path, expected_path)
        .unwrap_or_else(|_| actual_path.to_path_buf())
}

fn mp4_needs_compatibility_pass(ffprobe_path: &Path, path: &Path) -> bool {
    let path_text = path.to_string_lossy().into_owned();
    let output = ffprobe_command(ffprobe_path)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name",
            "-of",
            "json",
            path_text.as_str(),
        ])
        .output();
    let Ok(output) = output else {
        return true;
    };
    if !output.status.success() {
        return true;
    }
    let Ok(json) = serde_json::from_slice::<Value>(&output.stdout) else {
        return true;
    };
    !mp4_is_windows_compatible_from_probe_json(&json)
}

fn mp4_is_windows_compatible_from_probe_json(json: &Value) -> bool {
    let Some(streams) = json.get("streams").and_then(Value::as_array) else {
        return false;
    };
    let mut has_video = false;
    for stream in streams {
        let codec_type = stream.get("codec_type").and_then(Value::as_str);
        let codec_name = stream
            .get("codec_name")
            .and_then(Value::as_str)
            .unwrap_or("");
        match codec_type {
            Some("video") => {
                has_video = true;
                if codec_name != "h264" {
                    return false;
                }
            }
            Some("audio") => {
                if codec_name != "aac" && codec_name != "mp3" {
                    return false;
                }
            }
            _ => {}
        }
    }
    has_video
}

fn transcode_windows_compatible_mp4(ffmpeg_path: &Path, path: &Path) -> Result<PathBuf, String> {
    transcode_to_windows_compatible_mp4(ffmpeg_path, path, path)
}

fn transcode_to_windows_compatible_mp4(
    ffmpeg_path: &Path,
    input: &Path,
    final_path: &Path,
) -> Result<PathBuf, String> {
    if final_path.exists() && final_path != input {
        return Err("target mp4 already exists".to_string());
    }
    let temp_path = final_path.with_extension("snapbar-compatible.mp4");
    let input_path = input.to_string_lossy().into_owned();
    let output_path = temp_path.to_string_lossy().into_owned();
    let status = ffmpeg_command(ffmpeg_path)
        .args([
            "-y",
            "-i",
            input_path.as_str(),
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            output_path.as_str(),
        ])
        .status()
        .map_err(|e| format!("ffmpeg transcode: {e}"))?;
    if !status.success() || !temp_path.is_file() {
        let _ = fs::remove_file(&temp_path);
        return Err("ffmpeg transcode failed".to_string());
    }
    fs::remove_file(input).map_err(|e| format!("remove original video: {e}"))?;
    fs::rename(&temp_path, final_path).map_err(|e| format!("replace compatible mp4: {e}"))?;
    Ok(final_path.to_path_buf())
}

fn ffmpeg_has_nvenc(text: &str) -> bool {
    text.to_ascii_lowercase().contains("h264_nvenc")
}

fn detect_hardware_acceleration(ffmpeg_path: &Path) -> HardwareAcceleration {
    let output = ffmpeg_command(ffmpeg_path)
        .args(["-hide_banner", "-encoders"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    match output {
        Ok(output) => {
            let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            if ffmpeg_has_nvenc(&text) {
                HardwareAcceleration::Gpu
            } else {
                HardwareAcceleration::Cpu
            }
        }
        Err(_) => HardwareAcceleration::Cpu,
    }
}

fn available_video_qualities(json: &Value) -> Vec<VideoQualityPreset> {
    let mut has_480 = false;
    let mut has_720 = false;
    let mut has_1080 = false;
    if let Some(formats) = json.get("formats").and_then(Value::as_array) {
        for format in formats {
            if format.get("vcodec").and_then(Value::as_str) == Some("none") {
                continue;
            }
            if let Some(height) = format.get("height").and_then(Value::as_u64) {
                has_480 |= height >= 480;
                has_720 |= height >= 720;
                has_1080 |= height >= 1080;
            }
        }
    }

    let mut qualities = vec![VideoQualityPreset::Auto];
    if has_1080 {
        qualities.push(VideoQualityPreset::P1080);
    }
    if has_720 {
        qualities.push(VideoQualityPreset::P720);
    }
    if has_480 {
        qualities.push(VideoQualityPreset::P480);
    }
    qualities
}

fn download_output_dir(output_dir: Option<&str>) -> Result<PathBuf, String> {
    if let Some(value) = output_dir.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(value));
    }
    default_download_dir()
}

fn default_download_dir() -> Result<PathBuf, String> {
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        return Ok(PathBuf::from(userprofile).join("Downloads"));
    }
    if let Ok(home) = std::env::var("HOME") {
        return Ok(PathBuf::from(home).join("Downloads"));
    }
    Err("Nao consegui encontrar a pasta Downloads do Windows.".to_string())
}

fn unique_output_path(dir: &Path, title: &str, extension: &str) -> PathBuf {
    let stem = sanitize_filename(title);
    let mut path = dir.join(format!("{stem}.{extension}"));
    let mut suffix = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{suffix}.{extension}"));
        suffix += 1;
    }
    path
}

fn resolve_completed_output_path(
    expected: &Path,
    output_dir: &Path,
    output_stem: &str,
    expected_extension: &str,
) -> PathBuf {
    if expected.is_file() {
        return expected.to_path_buf();
    }
    let expected_extension = expected_extension.to_ascii_lowercase();
    fs::read_dir(output_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(Result::ok))
        .map(|entry| entry.path())
        .find(|path| {
            path.file_stem().and_then(|value| value.to_str()) == Some(output_stem)
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| value.eq_ignore_ascii_case(&expected_extension))
                    .unwrap_or(false)
        })
        .or_else(|| {
            fs::read_dir(output_dir)
                .ok()?
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .find(|path| {
                    path.is_file()
                        && path.file_stem().and_then(|value| value.to_str()) == Some(output_stem)
                        && path
                            .file_name()
                            .and_then(|value| value.to_str())
                            .map(|file_name| !is_partial_download_file(file_name))
                            .unwrap_or(false)
                })
        })
        .unwrap_or_else(|| expected.to_path_buf())
}

fn cleanup_partial_download(process: &InternetDownloadProcess) {
    let _ = fs::remove_file(&process.output_path);
    if let Ok(entries) = fs::read_dir(&process.output_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if file_name.starts_with(&process.output_stem) && is_partial_download_file(file_name) {
                let _ = fs::remove_file(path);
            }
        }
    }
}

fn is_partial_download_file(file_name: &str) -> bool {
    file_name.contains(".part") || file_name.contains(".ytdl") || file_name.ends_with(".tmp")
}

fn download_error_from_output(stderr: &[u8], fallback: &str) -> String {
    let message = download_error_message(stderr);
    if message.is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

fn should_retry_with_conservative_fallback(stderr: &str) -> bool {
    let text = stderr.to_ascii_lowercase();
    if text.contains("private")
        || text.contains("login")
        || text.contains("cookies")
        || text.contains("members-only")
        || text.contains("age-restricted")
    {
        return false;
    }

    text.contains("network")
        || text.contains("timed out")
        || text.contains("http error")
        || text.contains("unable to download")
        || text.contains("read operation timed out")
        || text.contains("connection")
        || text.contains("temporary failure")
        || text.contains("server returned")
        || text.contains("fragment")
        || text.contains("incomplete")
        || text.contains("requested format is not available")
        || text.contains("no video formats found")
        || text.contains("no such format")
        || text.contains("403")
        || text.contains("forbidden")
}

fn download_error_message(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if text.contains("sign in to confirm") || text.contains("bot") || text.contains("captcha") {
        "O YouTube bloqueou este download agora. Tente MP3, 720p ou tente novamente em alguns minutos.".to_string()
    } else if text.contains("private")
        || text.contains("login")
        || text.contains("cookies")
        || text.contains("members-only")
        || text.contains("age-restricted")
    {
        "Este video exige login ou permissao. O Snapbar baixa somente links publicos.".to_string()
    } else if text.contains("unsupported url") || text.contains("not a valid url") {
        "Nao consegui reconhecer este link.".to_string()
    } else if text.contains("requested format is not available")
        || text.contains("no video formats found")
        || text.contains("no such format")
    {
        "Esta qualidade nao esta disponivel neste video. Tente 720p ou 480p.".to_string()
    } else if text.contains("403") || text.contains("forbidden") {
        "O YouTube bloqueou este download agora. Tente MP3, 720p ou tente novamente em alguns minutos.".to_string()
    } else if text.contains("network")
        || text.contains("timed out")
        || text.contains("http error")
        || text.contains("unable to download")
        || text.contains("read operation timed out")
        || text.contains("connection")
    {
        "A rede falhou durante o download. O Snapbar tentou novamente; tente de novo em instantes."
            .to_string()
    } else {
        compact_download_error(stderr)
            .unwrap_or_else(|| "Nao foi possivel baixar este link.".to_string())
    }
}

fn compact_download_error(stderr: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(stderr);
    text.lines()
        .rev()
        .map(str::trim)
        .find(|line| {
            let lower = line.to_ascii_lowercase();
            !line.is_empty()
                && (lower.contains("error:")
                    || lower.contains("warning:")
                    || lower.contains("unable to")
                    || lower.contains("failed"))
        })
        .map(|line| {
            line.replace("ERROR:", "")
                .replace("WARNING:", "")
                .trim()
                .chars()
                .take(180)
                .collect::<String>()
        })
        .filter(|line| !line.is_empty())
}

fn ytdlp_command(ytdlp_path: &Path, deno_path: &Path) -> Command {
    let mut command = hidden_command(ytdlp_path);
    if let Some(deno_dir) = deno_path.parent() {
        let existing_path = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = std::env::split_paths(&existing_path).collect::<Vec<_>>();
        paths.insert(0, deno_dir.to_path_buf());
        if let Ok(joined) = std::env::join_paths(paths) {
            command.env("PATH", joined);
        }
    }
    command
}

fn ffmpeg_command(ffmpeg_path: &Path) -> Command {
    hidden_command(ffmpeg_path)
}

fn ffprobe_command(ffprobe_path: &Path) -> Command {
    hidden_command(ffprobe_path)
}

fn hidden_command(path: &Path) -> Command {
    crate::process::hidden_command(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("snapbar-internet-downloads-{name}-{nanos}"))
    }

    #[test]
    fn accepts_only_public_http_urls() {
        assert!(validate_download_url("https://www.youtube.com/watch?v=abc").is_ok());
        assert!(validate_download_url("http://example.com/video").is_ok());
        assert!(validate_download_url("file:///C:/Users/Lari/video.mp4").is_err());
        assert!(validate_download_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn sanitizes_titles_for_windows_filenames() {
        assert_eq!(sanitize_filename(" A <bad>: title?* | "), "A bad title");
        assert_eq!(sanitize_filename(""), "download");
    }

    #[test]
    fn video_quality_presets_map_to_ytdlp_format_selectors() {
        let args = build_ytdlp_download_args(
            &PathBuf::from(r"C:\tools\yt-dlp.exe"),
            &PathBuf::from(r"C:\tools\deno.exe"),
            &PathBuf::from(r"C:\tools\ffmpeg.exe"),
            &PathBuf::from(r"C:\Users\Lari\Downloads"),
            "https://example.com/video",
            &InternetDownloadOptions {
                format: DownloadFormat::Mp4,
                video_quality: Some(VideoQualityPreset::P720),
                audio_quality_kbps: Some(192),
                output_dir: None,
            },
            "video.mp4",
            DownloadAttemptKind::Primary,
        );

        assert!(args.windows(2).any(|pair| pair == [
            "-f",
            "bv*[height<=720][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]"
        ]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--merge-output-format", "mp4"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--recode-video", "mp4"]));
        assert!(args.iter().any(|arg| arg == "--no-playlist"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--js-runtimes", r"deno:C:\tools\deno.exe"]));
        assert!(args.windows(2).any(|pair| pair == ["--retries", "10"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--fragment-retries", "10"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--socket-timeout", "30"]));
        assert!(!args.iter().any(|arg| arg.contains("cookies")));
    }

    #[test]
    fn mp3_downloads_use_requested_bitrate_and_extract_audio() {
        let args = build_ytdlp_download_args(
            &PathBuf::from(r"C:\tools\yt-dlp.exe"),
            &PathBuf::from(r"C:\tools\deno.exe"),
            &PathBuf::from(r"C:\tools\ffmpeg.exe"),
            &PathBuf::from(r"C:\Users\Lari\Downloads"),
            "https://example.com/video",
            &InternetDownloadOptions {
                format: DownloadFormat::Mp3,
                video_quality: Some(VideoQualityPreset::Auto),
                audio_quality_kbps: Some(320),
                output_dir: None,
            },
            "song.mp3",
            DownloadAttemptKind::Primary,
        );

        assert!(args.iter().any(|arg| arg == "--extract-audio"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--audio-format", "mp3"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--audio-quality", "320K"]));
    }

    #[test]
    fn mp3_fallback_uses_conservative_youtube_args_and_320k_quality() {
        let args = build_ytdlp_download_args(
            &PathBuf::from(r"C:\tools\yt-dlp.exe"),
            &PathBuf::from(r"C:\tools\deno.exe"),
            &PathBuf::from(r"C:\tools\ffmpeg.exe"),
            &PathBuf::from(r"C:\Users\Lari\Downloads"),
            "https://example.com/video",
            &InternetDownloadOptions {
                format: DownloadFormat::Mp3,
                video_quality: Some(VideoQualityPreset::Auto),
                audio_quality_kbps: Some(320),
                output_dir: None,
            },
            "song.mp3",
            DownloadAttemptKind::ConservativeFallback,
        );

        assert!(args
            .windows(2)
            .any(|pair| pair == ["-f", "bestaudio[ext=m4a]/bestaudio/b"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--audio-quality", "320K"]));
        assert!(args.iter().any(|arg| arg == "--force-ipv4"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--concurrent-fragments", "1"]));
        assert!(args
            .windows(2)
            .any(|pair| { pair == ["--extractor-args", "youtube:player_client=android,web"] }));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--retry-sleep", "http:linear=2:10:2"]));
    }

    #[test]
    fn mp4_fallback_relaxes_selector_and_keeps_mp4_output() {
        let args = build_ytdlp_download_args(
            &PathBuf::from(r"C:\tools\yt-dlp.exe"),
            &PathBuf::from(r"C:\tools\deno.exe"),
            &PathBuf::from(r"C:\tools\ffmpeg.exe"),
            &PathBuf::from(r"C:\Users\Lari\Downloads"),
            "https://example.com/video",
            &InternetDownloadOptions {
                format: DownloadFormat::Mp4,
                video_quality: Some(VideoQualityPreset::P720),
                audio_quality_kbps: Some(192),
                output_dir: None,
            },
            "video.mp4",
            DownloadAttemptKind::ConservativeFallback,
        );

        assert!(args.windows(2).any(|pair| {
            pair == ["-f", "bv*[height<=720]+ba/b[height<=720]/best[height<=720]"]
        }));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--merge-output-format", "mp4"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--recode-video", "mp4"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--concurrent-fragments", "1"]));
    }

    #[test]
    fn network_or_format_errors_trigger_conservative_fallback() {
        assert!(should_retry_with_conservative_fallback(
            "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        ));
        assert!(should_retry_with_conservative_fallback(
            "ERROR: requested format is not available"
        ));
        assert!(should_retry_with_conservative_fallback(
            "ERROR: read operation timed out"
        ));
        assert!(!should_retry_with_conservative_fallback(
            "ERROR: This video is private and requires login cookies"
        ));
    }

    #[test]
    fn parses_progress_template_lines() {
        let progress = parse_progress_line("snapbar:download|42.7|1.4MiB/s|Baixando").unwrap();

        assert_eq!(progress.progress_percent, Some(42.7));
        assert_eq!(progress.speed.as_deref(), Some("1.4MiB/s"));
        assert_eq!(progress.stage, "Baixando");
    }

    #[test]
    fn resolves_completed_video_saved_with_intermediate_extension() {
        let dir = unique_temp_dir("intermediate-extension");
        fs::create_dir_all(&dir).unwrap();
        let expected = dir.join("Video.mp4");
        let fallback = dir.join("Video.webm");
        fs::write(&fallback, b"video").unwrap();

        let resolved = resolve_completed_output_path(&expected, &dir, "Video", "mp4");

        assert_eq!(resolved, fallback);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ignores_partial_files_when_resolving_completed_output() {
        let dir = unique_temp_dir("partial-files");
        fs::create_dir_all(&dir).unwrap();
        let expected = dir.join("Video.mp4");
        fs::write(dir.join("Video.mp4.part"), b"partial").unwrap();
        fs::write(dir.join("Video.tmp"), b"partial").unwrap();

        let resolved = resolve_completed_output_path(&expected, &dir, "Video", "mp4");

        assert_eq!(resolved, expected);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn detects_nvenc_from_ffmpeg_encoder_output() {
        let text = " V..... h264_nvenc           NVIDIA NVENC H.264 encoder";

        assert!(ffmpeg_has_nvenc(text));
    }

    #[test]
    fn treats_h264_aac_mp4_as_windows_compatible() {
        let json = serde_json::json!({
            "streams": [
                { "codec_type": "video", "codec_name": "h264" },
                { "codec_type": "audio", "codec_name": "aac" }
            ]
        });

        assert!(mp4_is_windows_compatible_from_probe_json(&json));
    }

    #[test]
    fn treats_vp9_or_opus_mp4_as_not_windows_compatible() {
        let json = serde_json::json!({
            "streams": [
                { "codec_type": "video", "codec_name": "vp9" },
                { "codec_type": "audio", "codec_name": "opus" }
            ]
        });

        assert!(!mp4_is_windows_compatible_from_probe_json(&json));
    }

    #[test]
    fn maps_large_video_download_failures_to_actionable_messages() {
        assert_eq!(
            download_error_message(b"ERROR: requested format is not available"),
            "Esta qualidade nao esta disponivel neste video. Tente 720p ou 480p."
        );
        assert_eq!(
            download_error_message(b"ERROR: unable to download video data: HTTP Error 403: Forbidden"),
            "O YouTube bloqueou este download agora. Tente MP3, 720p ou tente novamente em alguns minutos."
        );
        assert_eq!(
            download_error_message(b"ERROR: read operation timed out"),
            "A rede falhou durante o download. O Snapbar tentou novamente; tente de novo em instantes."
        );
    }
}
