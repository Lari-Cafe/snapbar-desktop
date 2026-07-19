Place desktop helper binaries here before packaging Snapbar.

Expected Windows layout:

- `ffmpeg.exe`

Release builds must use the bundled binary declared in
`src-tauri/runtime-assets.json`. Debug builds may use `SNAPBAR_FFMPEG_PATH` for
developer testing only; end users must never configure PATH or install FFmpeg.
