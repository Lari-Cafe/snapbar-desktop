use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const START_PROCESS_CHECK_MS: u64 = 80;
const START_AUDIO_CHECK_MS: u64 = 30;
const NATIVE_AUDIO_READY_WAIT_MS: u64 = 120;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub output_path: String,
    pub audio_sources: Vec<String>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingOptions {
    pub include_microphone: Option<bool>,
    pub include_system_audio: Option<bool>,
    pub microphone_device: Option<String>,
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioSource {
    pub name: String,
    pub kind: String,
}

#[derive(Clone)]
pub struct RecordingState {
    current: Arc<Mutex<Option<RecordingProcess>>>,
    audio_devices: Arc<Mutex<Option<Vec<AudioSource>>>>,
    ffmpeg_capabilities: Arc<Mutex<Option<FfmpegCapabilities>>>,
}

struct RecordingProcess {
    child: Child,
    ffmpeg_path: PathBuf,
    output_path: PathBuf,
    ffmpeg_output_path: PathBuf,
    audio_sources: Vec<String>,
    warning: Option<String>,
    dshow_audio_capture: Option<FfmpegAudioCapture>,
    native_system_audio: Option<NativeSystemAudioCapture>,
}

struct FfmpegAudioCapture {
    child: Child,
    path: PathBuf,
}

struct NativeSystemAudioCapture {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<Result<(), String>>,
    path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CaptureArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    output_index: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CaptureBackend {
    DesktopDuplication,
    GdiGrab,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VideoEncoder {
    Nvenc,
    Software,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FfmpegCapabilities {
    ddagrab: bool,
    h264_nvenc: bool,
}

impl Default for RecordingState {
    fn default() -> Self {
        Self {
            current: Arc::new(Mutex::new(None)),
            audio_devices: Arc::new(Mutex::new(None)),
            ffmpeg_capabilities: Arc::new(Mutex::new(None)),
        }
    }
}

impl RecordingState {
    fn cached_audio_sources(&self, ffmpeg_path: &Path, options: &RecordingOptions) -> Vec<String> {
        let devices = self.cached_or_detect_audio_devices(ffmpeg_path);
        select_audio_sources(&devices, options)
    }

    fn refresh_audio_devices(&self, ffmpeg_path: &Path) -> Vec<AudioSource> {
        let devices = detect_audio_devices(ffmpeg_path);
        if let Ok(mut cache) = self.audio_devices.lock() {
            *cache = Some(devices.clone());
        }
        devices
    }

    fn cached_or_detect_audio_devices(&self, ffmpeg_path: &Path) -> Vec<AudioSource> {
        if let Ok(cache) = self.audio_devices.lock() {
            if let Some(devices) = cache.as_ref() {
                return devices.clone();
            }
        }
        self.refresh_audio_devices(ffmpeg_path)
    }

    fn warm_probe_cache(&self, ffmpeg_path: &Path) {
        let _ = self.cached_or_detect_audio_devices(ffmpeg_path);
        let _ = self.cached_ffmpeg_capabilities(ffmpeg_path);
    }

    fn cached_ffmpeg_capabilities(&self, ffmpeg_path: &Path) -> FfmpegCapabilities {
        if let Ok(cache) = self.ffmpeg_capabilities.lock() {
            if let Some(capabilities) = *cache {
                return capabilities;
            }
        }
        let capabilities = detect_ffmpeg_capabilities(ffmpeg_path);
        if let Ok(mut cache) = self.ffmpeg_capabilities.lock() {
            *cache = Some(capabilities);
        }
        capabilities
    }
}

#[tauri::command]
pub async fn start_screen_recording(
    window: tauri::Window,
    state: tauri::State<'_, RecordingState>,
    options: Option<RecordingOptions>,
) -> Result<RecordingStatus, String> {
    let state = state.inner().clone();
    run_recording_worker("recording worker", move || {
        start_screen_recording_blocking(window, state, options)
    })
    .await
}

fn start_screen_recording_blocking(
    window: tauri::Window,
    state: RecordingState,
    options: Option<RecordingOptions>,
) -> Result<RecordingStatus, String> {
    let mut guard = state
        .current
        .lock()
        .map_err(|_| "recording state lock poisoned".to_string())?;

    if let Some(current) = guard.as_ref() {
        return Ok(status(true, current));
    }

    let options = options.unwrap_or_default();
    let app = window.app_handle().clone();
    crate::runtime_assets::ensure_feature_available(
        &app,
        crate::runtime_assets::RuntimeFeature::Recording,
    )?;
    let ffmpeg_path =
        crate::tool_paths::resolve_required_tool_path(Some(&app), "ffmpeg", "Gravacao de tela")?;
    let ffmpeg_audio_sources = state.cached_audio_sources(&ffmpeg_path, &options);
    let has_dshow_system_audio = has_system_audio_source(&ffmpeg_audio_sources);
    let output_path = recording_output_path(options.output_dir.as_deref())?;
    let mut audio_sources = ffmpeg_audio_sources.clone();
    let mut warning = None;
    let use_native_system_audio =
        options.include_system_audio.unwrap_or(true) && !has_dshow_system_audio;
    let use_dshow_audio = !ffmpeg_audio_sources.is_empty();

    if use_native_system_audio {
        audio_sources.push(native_system_audio_label());
    }

    if warning.is_none() {
        warning = build_audio_warning(&audio_sources, &options);
    }

    let capture_area = capture_area_for_window(&window)?;
    let ffmpeg_output_path = if use_dshow_audio || use_native_system_audio {
        sidecar_path(&output_path, "video.mp4")
    } else {
        output_path.clone()
    };
    let capabilities = state.cached_ffmpeg_capabilities(&ffmpeg_path);
    let capture_backend = preferred_capture_backend(capabilities, capture_area);
    let video_encoder = preferred_video_encoder(capabilities);

    let (child, _capture_backend, _video_encoder) = match spawn_recording_ffmpeg(
        &ffmpeg_path,
        &ffmpeg_output_path,
        capture_area,
        capture_backend,
        video_encoder,
    ) {
        Ok(result) => result,
        Err(err) => {
            cleanup_sidecars(&[
                ffmpeg_output_path.clone(),
                sidecar_path(&output_path, "system.wav"),
            ]);
            return Err(err);
        }
    };

    let mut dshow_audio_capture = None;
    if use_dshow_audio {
        match start_dshow_audio_capture(
            &ffmpeg_path,
            &ffmpeg_audio_sources,
            sidecar_path(&output_path, "dshow.wav"),
        ) {
            Ok(capture) => dshow_audio_capture = Some(capture),
            Err(err) => {
                audio_sources.retain(|source| !ffmpeg_audio_sources.contains(source));
                warning = Some(format!(
                    "audio de entrada nao iniciou ({err}); gravando tela sem esse audio"
                ));
            }
        }
    }

    let mut native_system_audio = None;
    if use_native_system_audio {
        match start_native_system_audio_capture(sidecar_path(&output_path, "system.wav")) {
            Ok(capture) => native_system_audio = Some(capture),
            Err(err) => {
                audio_sources.retain(|source| source != &native_system_audio_label());
                warning = Some(format!(
                    "audio do sistema nao iniciou ({err}); gravando microfone se disponivel"
                ));
            }
        }
    }

    if warning.is_none() {
        warning = build_audio_warning(&audio_sources, &options);
    }

    let process = RecordingProcess {
        child,
        ffmpeg_path,
        output_path,
        ffmpeg_output_path,
        audio_sources,
        warning,
        dshow_audio_capture,
        native_system_audio,
    };
    let response = status(true, &process);
    *guard = Some(process);
    Ok(response)
}

#[tauri::command]
pub async fn list_recording_audio_sources(
    app: AppHandle,
    state: tauri::State<'_, RecordingState>,
) -> Result<Vec<AudioSource>, String> {
    let state = state.inner().clone();
    run_recording_worker("recording audio worker", move || {
        list_recording_audio_sources_blocking(app, state)
    })
    .await
}

fn list_recording_audio_sources_blocking(
    app: AppHandle,
    state: RecordingState,
) -> Result<Vec<AudioSource>, String> {
    crate::runtime_assets::ensure_feature_available(
        &app,
        crate::runtime_assets::RuntimeFeature::Recording,
    )?;
    let ffmpeg_path =
        crate::tool_paths::resolve_required_tool_path(Some(&app), "ffmpeg", "Gravacao de tela")?;
    let devices = state.refresh_audio_devices(&ffmpeg_path);
    state.warm_probe_cache(&ffmpeg_path);
    Ok(audio_sources_with_native_fallback(devices))
}

fn audio_sources_with_native_fallback(mut sources: Vec<AudioSource>) -> Vec<AudioSource> {
    if !sources.iter().any(|source| source.kind == "system") {
        sources.push(AudioSource {
            name: native_system_audio_label(),
            kind: "system".to_string(),
        });
    }
    sources
}

#[tauri::command]
pub async fn stop_screen_recording(
    state: tauri::State<'_, RecordingState>,
) -> Result<RecordingStatus, String> {
    let state = state.inner().clone();
    run_recording_worker("recording stop worker", move || {
        stop_screen_recording_blocking(state)
    })
    .await
}

async fn run_recording_worker<T, F>(name: &'static str, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("{name}: {e}"))?
}

fn stop_screen_recording_blocking(state: RecordingState) -> Result<RecordingStatus, String> {
    let mut process = {
        let mut guard = state
            .current
            .lock()
            .map_err(|_| "recording state lock poisoned".to_string())?;
        guard
            .take()
            .ok_or_else(|| "Nenhuma gravacao em andamento".to_string())?
    };

    if let Some(stdin) = process.child.stdin.as_mut() {
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(_status) = process
            .child
            .try_wait()
            .map_err(|e| format!("ffmpeg wait: {e}"))?
        {
            break;
        }
        if Instant::now() >= deadline {
            let _ = process.child.kill();
            let _ = process.child.wait();
            break;
        }
        std::thread::sleep(Duration::from_millis(80));
    }

    let mut warning = process.warning;
    let mut audio_paths = Vec::new();
    if let Some(capture) = process.dshow_audio_capture {
        match capture.stop() {
            Ok(path) => audio_paths.push(path),
            Err(err) => {
                warning = Some(format!(
                    "audio de entrada falhou ao finalizar ({err}); salvando video sem esse audio"
                ));
            }
        }
    }
    if let Some(capture) = process.native_system_audio {
        match capture.stop() {
            Ok(system_audio_path) => audio_paths.push(system_audio_path),
            Err(err) => {
                warning = Some(format!(
                    "audio do sistema falhou ao finalizar ({err}); salvando video sem esse audio"
                ));
            }
        }
    }

    if !audio_paths.is_empty() {
        if let Err(err) = mux_audio_tracks(
            &process.ffmpeg_path,
            &process.ffmpeg_output_path,
            &audio_paths,
            &process.output_path,
        ) {
            warning = Some(format!(
                "falha ao juntar audio ({err}); salvando video sem esse audio"
            ));
            let _ = move_or_copy(&process.ffmpeg_output_path, &process.output_path);
        } else {
            let mut sidecars = vec![process.ffmpeg_output_path.clone()];
            sidecars.extend(audio_paths);
            cleanup_sidecars(&sidecars);
        }
    } else if process.ffmpeg_output_path != process.output_path {
        if let Err(err) = move_or_copy(&process.ffmpeg_output_path, &process.output_path) {
            warning = Some(format!("falha ao salvar video final ({err})"));
        }
    }

    Ok(RecordingStatus {
        is_recording: false,
        output_path: process.output_path.to_string_lossy().into_owned(),
        audio_sources: process.audio_sources,
        warning,
    })
}

fn status(is_recording: bool, process: &RecordingProcess) -> RecordingStatus {
    RecordingStatus {
        is_recording,
        output_path: process.output_path.to_string_lossy().into_owned(),
        audio_sources: process.audio_sources.clone(),
        warning: process.warning.clone(),
    }
}

fn spawn_ffmpeg(ffmpeg_path: &Path, args: &[String]) -> Result<Child, String> {
    let mut command = ffmpeg_background_command(ffmpeg_path, args);
    let child = command.spawn().map_err(|_| recording_start_error())?;

    ensure_child_keeps_running(
        child,
        START_PROCESS_CHECK_MS,
        |_| recording_start_error(),
        |_| recording_start_error(),
    )
}

fn spawn_recording_ffmpeg(
    ffmpeg_path: &Path,
    output_path: &Path,
    capture_area: CaptureArea,
    preferred_backend: CaptureBackend,
    preferred_encoder: VideoEncoder,
) -> Result<(Child, CaptureBackend, VideoEncoder), String> {
    let mut attempts = vec![(preferred_backend, preferred_encoder)];
    for attempt in [
        (preferred_backend, VideoEncoder::Software),
        (CaptureBackend::GdiGrab, preferred_encoder),
        (CaptureBackend::GdiGrab, VideoEncoder::Software),
    ] {
        if !attempts.contains(&attempt) {
            attempts.push(attempt);
        }
    }

    let mut last_error = None;
    for (backend, encoder) in attempts {
        let args = build_ffmpeg_args(output_path, capture_area, backend, encoder);
        match spawn_ffmpeg(ffmpeg_path, &args) {
            Ok(child) => return Ok((child, backend, encoder)),
            Err(err) => last_error = Some(err),
        }
    }

    Err(last_error.unwrap_or_else(recording_start_error))
}

fn recording_start_error() -> String {
    "A gravacao de tela nao conseguiu iniciar. Reinstale ou atualize o Snapbar e tente novamente."
        .to_string()
}

fn preferred_capture_backend(
    capabilities: FfmpegCapabilities,
    capture_area: CaptureArea,
) -> CaptureBackend {
    if capture_area.output_index.is_some() && capabilities.ddagrab {
        CaptureBackend::DesktopDuplication
    } else {
        CaptureBackend::GdiGrab
    }
}

fn preferred_video_encoder(capabilities: FfmpegCapabilities) -> VideoEncoder {
    if capabilities.h264_nvenc {
        VideoEncoder::Nvenc
    } else {
        VideoEncoder::Software
    }
}

fn detect_ffmpeg_capabilities(ffmpeg_path: &Path) -> FfmpegCapabilities {
    FfmpegCapabilities {
        ddagrab: ffmpeg_filter_available(ffmpeg_path, "ddagrab"),
        h264_nvenc: ffmpeg_encoder_available(ffmpeg_path, "h264_nvenc"),
    }
}

fn ffmpeg_encoder_available(ffmpeg_path: &Path, name: &str) -> bool {
    ffmpeg_capability_available(ffmpeg_path, ["-hide_banner", "-encoders"], name)
}

fn ffmpeg_filter_available(ffmpeg_path: &Path, name: &str) -> bool {
    ffmpeg_capability_available(ffmpeg_path, ["-hide_banner", "-filters"], name)
}

fn ffmpeg_capability_available<const N: usize>(
    ffmpeg_path: &Path,
    args: [&str; N],
    name: &str,
) -> bool {
    crate::process::hidden_command(ffmpeg_path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map(|output| {
            let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            text.contains(name)
        })
        .unwrap_or(false)
}

fn recording_output_path(output_dir: Option<&str>) -> Result<PathBuf, String> {
    let dir = recordings_dir(output_dir)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir recordings: {e}"))?;
    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    Ok(dir.join(format!("recording-{timestamp}.mp4")))
}

fn sidecar_path(output_path: &Path, suffix: &str) -> PathBuf {
    let stem = output_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("recording");
    output_path.with_file_name(format!("{stem}.{suffix}"))
}

fn capture_area_for_window(window: &tauri::Window) -> Result<CaptureArea, String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("monitor atual: {e}"))?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "monitor da toolbar nao encontrado".to_string())?;

    let position = monitor.position();
    let size = monitor.size();
    let output_index = window.available_monitors().ok().and_then(|monitors| {
        monitors.iter().position(|candidate| {
            let candidate_position = candidate.position();
            let candidate_size = candidate.size();
            candidate_position.x == position.x
                && candidate_position.y == position.y
                && candidate_size.width == size.width
                && candidate_size.height == size.height
        })
    });

    Ok(CaptureArea {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        output_index,
    })
}

impl NativeSystemAudioCapture {
    fn stop(self) -> Result<PathBuf, String> {
        self.stop.store(true, Ordering::Release);
        match self.handle.join() {
            Ok(Ok(())) => Ok(self.path),
            Ok(Err(err)) => Err(err),
            Err(_) => Err("thread WASAPI encerrou com panic".to_string()),
        }
    }
}

impl FfmpegAudioCapture {
    fn stop(mut self) -> Result<PathBuf, String> {
        if let Some(stdin) = self.child.stdin.as_mut() {
            let _ = stdin.write_all(b"q\n");
            let _ = stdin.flush();
        }

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = self
                .child
                .try_wait()
                .map_err(|e| format!("ffmpeg audio wait: {e}"))?
            {
                if status.success() || self.path.is_file() {
                    return Ok(self.path);
                }
                return Err(format!("ffmpeg audio saiu com status {status}"));
            }
            if Instant::now() >= deadline {
                let _ = self.child.kill();
                let _ = self.child.wait();
                if self.path.is_file() {
                    return Ok(self.path);
                }
                return Err("timeout finalizando audio".to_string());
            }
            std::thread::sleep(Duration::from_millis(80));
        }
    }
}

fn native_system_audio_label() -> String {
    "Audio do sistema (WASAPI)".to_string()
}

fn start_dshow_audio_capture(
    ffmpeg_path: &Path,
    audio_sources: &[String],
    output_path: PathBuf,
) -> Result<FfmpegAudioCapture, String> {
    if audio_sources.is_empty() {
        return Err("nenhuma entrada de audio selecionada".to_string());
    }

    let args = build_dshow_audio_capture_args(audio_sources, &output_path);
    let mut command = ffmpeg_background_command(ffmpeg_path, &args);
    let child = command
        .spawn()
        .map_err(|e| format!("ffmpeg audio nao iniciou: {e}"))?;
    let child = ensure_child_keeps_running(
        child,
        START_AUDIO_CHECK_MS,
        |e| format!("ffmpeg audio status: {e}"),
        |status| format!("ffmpeg audio saiu com status {status}"),
    )?;
    Ok(FfmpegAudioCapture {
        child,
        path: output_path,
    })
}

fn ffmpeg_background_command(ffmpeg_path: &Path, args: &[String]) -> Command {
    let mut command = crate::process::hidden_command(ffmpeg_path);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    command
}

fn ensure_child_keeps_running(
    mut child: Child,
    check_after_ms: u64,
    wait_error: impl FnOnce(std::io::Error) -> String,
    exited_error: impl FnOnce(ExitStatus) -> String,
) -> Result<Child, String> {
    std::thread::sleep(Duration::from_millis(check_after_ms));
    match child.try_wait().map_err(wait_error)? {
        Some(status) => Err(exited_error(status)),
        None => Ok(child),
    }
}

fn start_native_system_audio_capture(path: PathBuf) -> Result<NativeSystemAudioCapture, String> {
    start_native_system_audio_capture_impl(path)
}

#[cfg(windows)]
fn start_native_system_audio_capture_impl(
    path: PathBuf,
) -> Result<NativeSystemAudioCapture, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);
    let thread_path = path.clone();
    let (ready_tx, ready_rx) = mpsc::channel();
    let handle = std::thread::Builder::new()
        .name("wasapi-system-audio".to_string())
        .spawn(move || native_system_audio_loop(thread_path, stop_for_thread, ready_tx))
        .map_err(|e| format!("thread WASAPI: {e}"))?;

    match ready_rx.recv_timeout(Duration::from_millis(NATIVE_AUDIO_READY_WAIT_MS)) {
        Ok(Ok(())) => Ok(NativeSystemAudioCapture { stop, handle, path }),
        Ok(Err(err)) => {
            let _ = handle.join();
            Err(err)
        }
        Err(_) => Ok(NativeSystemAudioCapture { stop, handle, path }),
    }
}

#[cfg(not(windows))]
fn start_native_system_audio_capture_impl(
    _path: PathBuf,
) -> Result<NativeSystemAudioCapture, String> {
    Err("WASAPI loopback so existe no Windows".to_string())
}

#[cfg(windows)]
fn native_system_audio_loop(
    path: PathBuf,
    stop: Arc<AtomicBool>,
    ready_tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    let initialized = wasapi::initialize_mta()
        .ok()
        .map_err(|e| format!("CoInitialize WASAPI: {e:?}"));
    if let Err(err) = initialized {
        let _ = ready_tx.send(Err(err.clone()));
        return Err(err);
    }

    let result = native_system_audio_loop_inner(path, stop, ready_tx);
    wasapi::deinitialize();
    result
}

#[cfg(windows)]
fn native_system_audio_loop_inner(
    path: PathBuf,
    stop: Arc<AtomicBool>,
    ready_tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use std::collections::VecDeque;

    let enumerator = wasapi::DeviceEnumerator::new().map_err(|e| format!("WASAPI enum: {e}"))?;
    let device = enumerator
        .get_default_device(&wasapi::Direction::Render)
        .map_err(|e| format!("saida padrao WASAPI: {e}"))?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|e| format!("audio client WASAPI: {e}"))?;

    let desired_format =
        wasapi::WaveFormat::new(32, 32, &wasapi::SampleType::Float, 48_000, 2, None);
    let blockalign = desired_format.get_blockalign() as usize;
    let (_default_period, min_period) = audio_client
        .get_device_period()
        .map_err(|e| format!("periodo WASAPI: {e}"))?;
    let mode = wasapi::StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_period,
    };
    audio_client
        .initialize_client(&desired_format, &wasapi::Direction::Capture, &mode)
        .map_err(|e| format!("inicializar loopback WASAPI: {e}"))?;

    let event = audio_client
        .set_get_eventhandle()
        .map_err(|e| format!("evento WASAPI: {e}"))?;
    let buffer_frame_count = audio_client
        .get_buffer_size()
        .map_err(|e| format!("buffer WASAPI: {e}"))?;
    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| format!("capture client WASAPI: {e}"))?;

    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: 48_000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer =
        hound::WavWriter::create(&path, spec).map_err(|e| format!("criar WAV do sistema: {e}"))?;
    let mut sample_queue: VecDeque<u8> =
        VecDeque::with_capacity(4 * blockalign * buffer_frame_count as usize);

    audio_client
        .start_stream()
        .map_err(|e| format!("iniciar stream WASAPI: {e}"))?;
    let _ = ready_tx.send(Ok(()));

    while !stop.load(Ordering::Acquire) {
        capture_client
            .read_from_device_to_deque(&mut sample_queue)
            .map_err(|e| format!("ler audio do sistema: {e}"))?;
        write_wav_samples(&mut writer, &mut sample_queue)?;
        let _ = event.wait_for_event(200);
    }

    let _ = audio_client.stop_stream();
    write_wav_samples(&mut writer, &mut sample_queue)?;
    writer
        .finalize()
        .map_err(|e| format!("finalizar WAV do sistema: {e}"))?;
    Ok(())
}

#[cfg(windows)]
fn write_wav_samples(
    writer: &mut hound::WavWriter<std::io::BufWriter<std::fs::File>>,
    sample_queue: &mut std::collections::VecDeque<u8>,
) -> Result<(), String> {
    while sample_queue.len() >= 4 {
        let bytes = [
            sample_queue.pop_front().unwrap(),
            sample_queue.pop_front().unwrap(),
            sample_queue.pop_front().unwrap(),
            sample_queue.pop_front().unwrap(),
        ];
        writer
            .write_sample(f32::from_le_bytes(bytes))
            .map_err(|e| format!("escrever WAV do sistema: {e}"))?;
    }
    Ok(())
}

fn mux_audio_tracks(
    ffmpeg_path: &Path,
    video_path: &Path,
    audio_paths: &[PathBuf],
    output_path: &Path,
) -> Result<(), String> {
    let args = build_mux_audio_args(video_path, audio_paths, output_path);
    run_ffmpeg_to_completion(ffmpeg_path, &args)
}

fn build_mux_audio_args(
    video_path: &Path,
    audio_paths: &[PathBuf],
    output_path: &Path,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        video_path.to_string_lossy().into_owned(),
    ];

    for audio_path in audio_paths {
        args.extend(["-i".to_string(), audio_path.to_string_lossy().into_owned()]);
    }

    if audio_paths.len() > 1 {
        let labels = (1..=audio_paths.len())
            .map(|index| format!("[{index}:a]"))
            .collect::<String>();
        args.extend([
            "-filter_complex".to_string(),
            format!(
                "{labels}amix=inputs={}:duration=longest:normalize=0[aout]",
                audio_paths.len()
            ),
            "-map".to_string(),
            "0:v".to_string(),
            "-map".to_string(),
            "[aout]".to_string(),
        ]);
    } else if audio_paths.len() == 1 {
        args.extend([
            "-map".to_string(),
            "0:v".to_string(),
            "-map".to_string(),
            "1:a".to_string(),
        ]);
    } else {
        args.extend(["-map".to_string(), "0:v".to_string(), "-an".to_string()]);
    }

    args.extend([
        "-fflags".to_string(),
        "+genpts".to_string(),
        "-avoid_negative_ts".to_string(),
        "make_zero".to_string(),
        "-c:v".to_string(),
        "copy".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-shortest".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().into_owned(),
    ]);
    args
}

fn run_ffmpeg_to_completion(ffmpeg_path: &Path, args: &[String]) -> Result<(), String> {
    let mut command = crate::process::hidden_command(ffmpeg_path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|e| format!("ffmpeg mux nao iniciou: {e}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let tail = stderr
        .lines()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" | ");
    Err(if tail.is_empty() {
        format!("ffmpeg mux saiu com status {}", output.status)
    } else {
        format!("ffmpeg mux saiu com status {}: {tail}", output.status)
    })
}

fn move_or_copy(source: &Path, target: &Path) -> Result<(), String> {
    if source == target {
        return Ok(());
    }
    if fs::rename(source, target).is_ok() {
        return Ok(());
    }
    fs::copy(source, target).map_err(|e| format!("copiar video fallback: {e}"))?;
    let _ = fs::remove_file(source);
    Ok(())
}

fn cleanup_sidecars(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

fn recordings_dir(output_dir: Option<&str>) -> Result<PathBuf, String> {
    let userprofile = std::env::var("USERPROFILE").map_err(|e| format!("USERPROFILE: {e}"))?;
    Ok(recordings_dir_from_options(
        output_dir.map(|value| value.to_string()),
        &userprofile,
    ))
}

#[cfg(test)]
fn recordings_dir_from_userprofile(userprofile: &str) -> PathBuf {
    recordings_dir_from_options(None, userprofile)
}

fn recordings_dir_from_options(output_dir: Option<String>, userprofile: &str) -> PathBuf {
    match output_dir.map(|value| value.trim().to_string()) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => default_recordings_dir_from_userprofile(userprofile),
    }
}

fn default_recordings_dir_from_userprofile(userprofile: &str) -> PathBuf {
    PathBuf::from(userprofile)
        .join("Videos")
        .join("FloatingToolbar")
}

impl Default for RecordingOptions {
    fn default() -> Self {
        Self {
            include_microphone: Some(true),
            include_system_audio: Some(true),
            microphone_device: None,
            output_dir: None,
        }
    }
}

fn detect_audio_devices(ffmpeg_path: &Path) -> Vec<AudioSource> {
    let output = crate::process::hidden_command(ffmpeg_path)
        .args([
            "-hide_banner",
            "-list_devices",
            "true",
            "-f",
            "dshow",
            "-i",
            "dummy",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    match output {
        Ok(out) => {
            let mut text = String::from_utf8_lossy(&out.stderr).into_owned();
            text.push_str(&String::from_utf8_lossy(&out.stdout));
            parse_audio_devices(&text)
        }
        Err(_) => Vec::new(),
    }
}

fn select_audio_sources(devices: &[AudioSource], options: &RecordingOptions) -> Vec<String> {
    let mut sources = Vec::new();

    if options.include_microphone.unwrap_or(true) {
        if let Some(selected) = options.microphone_device.as_deref() {
            if devices
                .iter()
                .any(|device| device.name == selected && device.kind == "microphone")
            {
                sources.push(selected.to_string());
            }
        }
        if sources.is_empty() {
            if let Some(mic) = devices.iter().find(|device| device.kind == "microphone") {
                sources.push(mic.name.clone());
            }
        }
    }

    if options.include_system_audio.unwrap_or(true) {
        if let Some(system) = devices.iter().find(|device| device.kind == "system") {
            sources.push(system.name.clone());
        }
    }

    sources
}

#[cfg(test)]
fn parse_audio_sources(ffmpeg_output: &str) -> Vec<String> {
    let devices = parse_audio_devices(ffmpeg_output);
    select_audio_sources(&devices, &RecordingOptions::default())
}

fn parse_audio_devices(ffmpeg_output: &str) -> Vec<AudioSource> {
    let mut microphones = Vec::new();
    let mut system_sources = Vec::new();

    for line in ffmpeg_output.lines() {
        if !line.contains("(audio)") {
            continue;
        }
        let Some(name) = quoted_device_name(line) else {
            continue;
        };
        let lower = name.to_lowercase();
        if is_system_audio_source(&lower) {
            system_sources.push(AudioSource {
                name,
                kind: "system".to_string(),
            });
        } else if is_microphone_source(&lower) {
            microphones.push(AudioSource {
                name,
                kind: "microphone".to_string(),
            });
        }
    }

    microphones
        .into_iter()
        .chain(system_sources.into_iter())
        .collect()
}

fn quoted_device_name(line: &str) -> Option<String> {
    let start = line.find('"')? + 1;
    let end = line[start..].find('"')? + start;
    Some(line[start..end].to_string())
}

fn is_microphone_source(lower_name: &str) -> bool {
    !is_system_audio_source(lower_name)
        && !lower_name.contains("webcam")
        && !lower_name.contains("camera")
        && !lower_name.contains("virtual camera")
}

fn is_system_audio_source(lower_name: &str) -> bool {
    lower_name.contains("stereo mix")
        || lower_name.contains("wave out")
        || lower_name.contains("what u hear")
        || lower_name.contains("virtual-audio-capturer")
        || lower_name.contains("cable output")
        || lower_name.contains("voicemeeter")
        || lower_name.contains("loopback")
        || lower_name.contains("wasapi")
}

fn has_system_audio_source(audio_sources: &[String]) -> bool {
    audio_sources.iter().any(|source| {
        let lower = source.to_lowercase();
        is_system_audio_source(&lower)
    })
}

fn build_audio_warning(audio_sources: &[String], options: &RecordingOptions) -> Option<String> {
    if audio_sources.is_empty() {
        return Some("nenhum dispositivo de audio encontrado; gravando somente tela".to_string());
    }

    if has_system_audio_source(audio_sources) || !options.include_system_audio.unwrap_or(true) {
        return None;
    }

    Some("audio do sistema nao encontrado; gravando microfone se disponivel".to_string())
}

fn build_ffmpeg_args(
    output_path: &Path,
    capture_area: CaptureArea,
    capture_backend: CaptureBackend,
    video_encoder: VideoEncoder,
) -> Vec<String> {
    let mut args = vec!["-y".to_string()];
    append_capture_input_args(&mut args, capture_area, capture_backend, video_encoder);

    args.extend(["-map".to_string(), "0:v".to_string(), "-an".to_string()]);

    append_video_encoder_args(&mut args, capture_backend, video_encoder);

    args.push(output_path.to_string_lossy().into_owned());
    args
}

fn build_dshow_audio_capture_args(audio_sources: &[String], output_path: &Path) -> Vec<String> {
    let mut args = vec!["-y".to_string()];
    for source in audio_sources {
        args.extend([
            "-thread_queue_size".to_string(),
            "512".to_string(),
            "-f".to_string(),
            "dshow".to_string(),
            "-i".to_string(),
            format!("audio={source}"),
        ]);
    }

    if audio_sources.len() > 1 {
        let labels = (0..audio_sources.len())
            .map(|index| format!("[{index}:a]"))
            .collect::<String>();
        args.extend([
            "-filter_complex".to_string(),
            format!(
                "{labels}amix=inputs={}:duration=longest:normalize=0[aout]",
                audio_sources.len()
            ),
            "-map".to_string(),
            "[aout]".to_string(),
        ]);
    } else {
        args.extend(["-map".to_string(), "0:a".to_string()]);
    }

    args.extend([
        "-c:a".to_string(),
        "pcm_s16le".to_string(),
        "-ar".to_string(),
        "48000".to_string(),
        "-ac".to_string(),
        "2".to_string(),
        output_path.to_string_lossy().into_owned(),
    ]);
    args
}

fn append_capture_input_args(
    args: &mut Vec<String>,
    capture_area: CaptureArea,
    capture_backend: CaptureBackend,
    video_encoder: VideoEncoder,
) {
    match capture_backend {
        CaptureBackend::DesktopDuplication => {
            let output_index = capture_area.output_index.unwrap_or(0);
            let download_filter = match video_encoder {
                VideoEncoder::Nvenc => "",
                VideoEncoder::Software => ",hwdownload,format=bgra",
            };
            args.extend([
                "-f".to_string(),
                "lavfi".to_string(),
                "-i".to_string(),
                format!(
                    "ddagrab=output_idx={output_index}:framerate=30:video_size={}x{}:offset_x=0:offset_y=0:draw_mouse=1:dup_frames=1{download_filter}",
                    capture_area.width, capture_area.height
                ),
            ]);
        }
        CaptureBackend::GdiGrab => {
            args.extend([
                "-thread_queue_size".to_string(),
                "1024".to_string(),
                "-rtbufsize".to_string(),
                "512M".to_string(),
                "-f".to_string(),
                "gdigrab".to_string(),
                "-framerate".to_string(),
                "30".to_string(),
                "-draw_mouse".to_string(),
                "1".to_string(),
                "-video_size".to_string(),
                format!("{}x{}", capture_area.width, capture_area.height),
                "-offset_x".to_string(),
                capture_area.x.to_string(),
                "-offset_y".to_string(),
                capture_area.y.to_string(),
                "-i".to_string(),
                "desktop".to_string(),
            ]);
        }
    }
}

fn append_video_encoder_args(
    args: &mut Vec<String>,
    capture_backend: CaptureBackend,
    video_encoder: VideoEncoder,
) {
    args.extend([
        "-fps_mode".to_string(),
        "cfr".to_string(),
        "-r".to_string(),
        "30".to_string(),
    ]);

    match video_encoder {
        VideoEncoder::Nvenc => {
            args.extend([
                "-c:v".to_string(),
                "h264_nvenc".to_string(),
                "-preset".to_string(),
                "p1".to_string(),
                "-tune".to_string(),
                "ull".to_string(),
                "-rc".to_string(),
                "vbr".to_string(),
                "-cq".to_string(),
                "24".to_string(),
                "-b:v".to_string(),
                "8M".to_string(),
                "-maxrate".to_string(),
                "16M".to_string(),
                "-bufsize".to_string(),
                "32M".to_string(),
                "-g".to_string(),
                "60".to_string(),
                "-bf".to_string(),
                "0".to_string(),
            ]);
            if capture_backend != CaptureBackend::DesktopDuplication {
                args.extend(["-pix_fmt".to_string(), "yuv420p".to_string()]);
            }
        }
        VideoEncoder::Software => {
            args.extend([
                "-c:v".to_string(),
                "libx264".to_string(),
                "-preset".to_string(),
                "ultrafast".to_string(),
                "-tune".to_string(),
                "zerolatency".to_string(),
                "-crf".to_string(),
                "23".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn primary_area() -> CaptureArea {
        CaptureArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            output_index: Some(0),
        }
    }

    #[test]
    fn ffmpeg_args_capture_the_desktop_until_stopped() {
        let output = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.mp4");

        let args = build_ffmpeg_args(
            &output,
            primary_area(),
            CaptureBackend::GdiGrab,
            VideoEncoder::Software,
        );

        assert!(args.windows(2).any(|pair| pair == ["-f", "gdigrab"]));
        assert!(args.windows(2).any(|pair| pair == ["-framerate", "30"]));
        assert!(args.windows(2).any(|pair| pair == ["-rtbufsize", "512M"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-video_size", "1920x1080"]));
        assert!(args.windows(2).any(|pair| pair == ["-offset_x", "0"]));
        assert!(args.windows(2).any(|pair| pair == ["-offset_y", "0"]));
        assert!(args.windows(2).any(|pair| pair == ["-i", "desktop"]));
        assert!(!args.windows(2).any(|pair| pair == ["-f", "dshow"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:v"]));
        assert!(args.iter().any(|arg| arg == "-an"));
        assert!(args.windows(2).any(|pair| pair == ["-fps_mode", "cfr"]));
        assert!(args.windows(2).any(|pair| pair == ["-r", "30"]));
        assert!(args.windows(2).any(|pair| pair == ["-tune", "zerolatency"]));
        assert_eq!(args.last(), Some(&output.to_string_lossy().into_owned()));
        assert!(!args.iter().any(|arg| arg == "-t"));
    }

    #[test]
    fn ffmpeg_args_omit_audio_when_no_audio_sources_exist() {
        let output = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.mp4");

        let args = build_ffmpeg_args(
            &output,
            primary_area(),
            CaptureBackend::GdiGrab,
            VideoEncoder::Software,
        );

        assert!(!args.windows(2).any(|pair| pair == ["-f", "dshow"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:v"]));
        assert!(!args.iter().any(|arg| arg == "[aout]"));
    }

    #[test]
    fn ffmpeg_args_capture_only_the_toolbar_monitor_area() {
        let output = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.mp4");
        let area = CaptureArea {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
            output_index: Some(1),
        };

        let args = build_ffmpeg_args(
            &output,
            area,
            CaptureBackend::GdiGrab,
            VideoEncoder::Software,
        );

        assert!(args
            .windows(2)
            .any(|pair| pair == ["-video_size", "1920x1080"]));
        assert!(args.windows(2).any(|pair| pair == ["-offset_x", "-1920"]));
        assert!(args.windows(2).any(|pair| pair == ["-offset_y", "0"]));
    }

    #[test]
    fn ffmpeg_args_can_use_desktop_duplication_with_nvenc() {
        let output = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.mp4");

        let args = build_ffmpeg_args(
            &output,
            primary_area(),
            CaptureBackend::DesktopDuplication,
            VideoEncoder::Nvenc,
        );

        assert!(args.windows(2).any(|pair| pair == ["-f", "lavfi"]));
        assert!(args.iter().any(|arg| arg.contains("ddagrab=output_idx=0")));
        assert!(args.iter().any(|arg| arg.contains("dup_frames=1")));
        assert!(!args
            .iter()
            .any(|arg| arg.contains("hwdownload,format=bgra")));
        assert!(args.windows(2).any(|pair| pair == ["-c:v", "h264_nvenc"]));
        assert!(args.windows(2).any(|pair| pair == ["-preset", "p1"]));
        assert!(args.windows(2).any(|pair| pair == ["-tune", "ull"]));
        assert!(args.windows(2).any(|pair| pair == ["-fps_mode", "cfr"]));
        assert!(!args.windows(2).any(|pair| pair == ["-pix_fmt", "yuv420p"]));
    }

    #[test]
    fn ffmpeg_args_download_desktop_duplication_frames_for_software_encoding() {
        let output = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.mp4");

        let args = build_ffmpeg_args(
            &output,
            primary_area(),
            CaptureBackend::DesktopDuplication,
            VideoEncoder::Software,
        );

        assert!(args.windows(2).any(|pair| pair == ["-f", "lavfi"]));
        assert!(args
            .iter()
            .any(|arg| arg.contains("hwdownload,format=bgra")));
        assert!(args.windows(2).any(|pair| pair == ["-c:v", "libx264"]));
        assert!(args.windows(2).any(|pair| pair == ["-pix_fmt", "yuv420p"]));
    }

    #[test]
    fn mux_args_mix_microphone_audio_with_native_system_audio() {
        let video = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.video.mp4");
        let microphone =
            PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.microphone.wav");
        let system = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.system.wav");
        let output = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.mp4");

        let audio_paths = vec![microphone.clone(), system.clone()];
        let args = build_mux_audio_args(&video, &audio_paths, &output);
        let video_arg = video.to_string_lossy().into_owned();
        let microphone_arg = microphone.to_string_lossy().into_owned();
        let system_arg = system.to_string_lossy().into_owned();

        assert!(args
            .windows(2)
            .any(|pair| pair == ["-i", video_arg.as_str()]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-i", microphone_arg.as_str()]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-i", system_arg.as_str()]));
        assert!(args.windows(2).any(|pair| pair
            == [
                "-filter_complex",
                "[1:a][2:a]amix=inputs=2:duration=longest:normalize=0[aout]"
            ]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:v"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "[aout]"]));
        assert!(args.windows(2).any(|pair| pair == ["-fflags", "+genpts"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-avoid_negative_ts", "make_zero"]));
        assert!(args.windows(2).any(|pair| pair == ["-c:v", "copy"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-shortest", "-movflags"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-movflags", "+faststart"]));
        assert_eq!(args.last(), Some(&output.to_string_lossy().into_owned()));
    }

    #[test]
    fn mux_args_map_native_system_audio_when_video_has_no_audio() {
        let video = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.video.mp4");
        let system = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.system.wav");
        let output = PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.mp4");

        let audio_paths = vec![system.clone()];
        let args = build_mux_audio_args(&video, &audio_paths, &output);

        assert!(!args.iter().any(|arg| arg == "-filter_complex"));
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:v"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "1:a"]));
    }

    #[test]
    fn audio_capture_args_mix_selected_dshow_sources_to_wav_sidecar() {
        let output =
            PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording.microphone.wav");
        let sources = vec![
            "Microphone (fifine Microphone)".to_string(),
            "Stereo Mix".to_string(),
        ];

        let args = build_dshow_audio_capture_args(&sources, &output);

        assert!(args.windows(2).any(|pair| pair == ["-f", "dshow"]));
        assert!(args
            .iter()
            .any(|arg| arg == "audio=Microphone (fifine Microphone)"));
        assert!(args.iter().any(|arg| arg == "audio=Stereo Mix"));
        assert!(args.windows(2).any(|pair| pair
            == [
                "-filter_complex",
                "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[aout]"
            ]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "[aout]"]));
        assert!(args.windows(2).any(|pair| pair == ["-c:a", "pcm_s16le"]));
        assert_eq!(args.last(), Some(&output.to_string_lossy().into_owned()));
    }

    #[test]
    fn sidecar_paths_keep_recording_timestamp() {
        let output =
            PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar\recording-20260527-231000.mp4");

        assert_eq!(
            sidecar_path(&output, "system.wav"),
            PathBuf::from(
                r"C:\Users\Lari\Videos\FloatingToolbar\recording-20260527-231000.system.wav"
            )
        );
    }

    #[test]
    fn audio_device_parser_prefers_microphone_and_system_loopback_sources() {
        let ffmpeg_output = r#"
[dshow @ 000001] "Iriun Webcam" (video)
[dshow @ 000001] "Microphone (fifine Microphone)" (audio)
[dshow @ 000001] "Stereo Mix (Realtek(R) Audio)" (audio)
[dshow @ 000001] "OBS Virtual Camera" (none)
"#;

        let sources = parse_audio_sources(ffmpeg_output);

        assert_eq!(
            sources,
            vec![
                "Microphone (fifine Microphone)".to_string(),
                "Stereo Mix (Realtek(R) Audio)".to_string()
            ]
        );
    }

    #[test]
    fn audio_device_parser_keeps_input_devices_without_microphone_in_the_name() {
        let ffmpeg_output = r#"
[dshow @ 000001] "Headset (Fuxi-H3)" (audio)
[dshow @ 000001] "Matriz de Microfones (Intel Smart Sound)" (audio)
[dshow @ 000001] "Audio do sistema (WASAPI)" (audio)
"#;

        let devices = parse_audio_devices(ffmpeg_output);

        assert_eq!(
            devices,
            vec![
                AudioSource {
                    name: "Headset (Fuxi-H3)".to_string(),
                    kind: "microphone".to_string(),
                },
                AudioSource {
                    name: "Matriz de Microfones (Intel Smart Sound)".to_string(),
                    kind: "microphone".to_string(),
                },
                AudioSource {
                    name: "Audio do sistema (WASAPI)".to_string(),
                    kind: "system".to_string(),
                }
            ]
        );
    }

    #[test]
    fn recording_state_reuses_cached_audio_devices_for_start_selection() {
        let state = RecordingState::default();
        *state.audio_devices.lock().unwrap() = Some(vec![
            AudioSource {
                name: "Microphone (fifine Microphone)".to_string(),
                kind: "microphone".to_string(),
            },
            AudioSource {
                name: "Stereo Mix (Realtek(R) Audio)".to_string(),
                kind: "system".to_string(),
            },
        ]);

        let sources = state.cached_audio_sources(
            Path::new(r"C:\Snapbar\ffmpeg.exe"),
            &RecordingOptions {
                include_microphone: Some(true),
                include_system_audio: Some(true),
                microphone_device: Some("Microphone (fifine Microphone)".to_string()),
                output_dir: None,
            },
        );

        assert_eq!(
            sources,
            vec![
                "Microphone (fifine Microphone)".to_string(),
                "Stereo Mix (Realtek(R) Audio)".to_string(),
            ]
        );
    }

    #[test]
    fn cached_ffmpeg_capabilities_drive_capture_backend_and_encoder() {
        let state = RecordingState::default();
        *state.ffmpeg_capabilities.lock().unwrap() = Some(FfmpegCapabilities {
            ddagrab: true,
            h264_nvenc: true,
        });

        let capabilities = state.cached_ffmpeg_capabilities(Path::new(r"C:\Snapbar\ffmpeg.exe"));

        assert_eq!(
            preferred_capture_backend(capabilities, primary_area()),
            CaptureBackend::DesktopDuplication
        );
        assert_eq!(preferred_video_encoder(capabilities), VideoEncoder::Nvenc);
    }

    #[test]
    fn recording_start_probe_waits_stay_short() {
        assert!(START_PROCESS_CHECK_MS <= 80);
        assert!(START_AUDIO_CHECK_MS <= 30);
        assert!(NATIVE_AUDIO_READY_WAIT_MS <= 120);
    }

    #[test]
    fn recordings_dir_uses_user_videos_folder() {
        let dir = recordings_dir_from_userprofile(r"C:\Users\Lari");

        assert_eq!(dir, PathBuf::from(r"C:\Users\Lari\Videos\FloatingToolbar"));
    }

    #[test]
    fn recordings_dir_uses_custom_output_dir_when_configured() {
        let dir =
            recordings_dir_from_options(Some(r"D:\Snapbar\Videos".to_string()), r"C:\Users\Lari");

        assert_eq!(dir, PathBuf::from(r"D:\Snapbar\Videos"));
    }
}
