use tauri::{AppHandle, Emitter};
use std::io::{BufRead, BufReader};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct VideoInfo {
    pub title: String,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub thumbnail: Option<String>,
    pub view_count: Option<u64>,
}

#[tauri::command]
async fn get_video_info(url: String) -> Result<VideoInfo, String> {
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("yt-dlp")
            .args(["--dump-json", "--no-playlist", &url])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("yt-dlp не найден: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| e.to_string())?;

    Ok(VideoInfo {
        title: json["title"].as_str().unwrap_or("Без названия").to_string(),
        duration: json["duration"].as_f64(),
        uploader: json["uploader"].as_str().map(|s| s.to_string()),
        thumbnail: json["thumbnail"].as_str().map(|s| s.to_string()),
        view_count: json["view_count"].as_u64(),
    })
}

#[tauri::command]
async fn download_video(
    app: AppHandle,
    url: String,
    format: String,
    quality: String,
    output_dir: String,
) -> Result<(), String> {
    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--no-playlist".into(),
        "-o".into(), format!("{}/%(title)s.%(ext)s", output_dir),
    ];

    match format.as_str() {
        "mp3" => {
            let q = match quality.as_str() {
                "128" => "5",
                "320" => "0",
                _     => "0",
            };
            args.extend([
                "-x".into(),
                "--audio-format".into(), "mp3".into(),
                "--audio-quality".into(), q.into(),
            ]);
        }
        "opus" => {
            args.extend(["-x".into(), "--audio-format".into(), "opus".into()]);
        }
        "mp4" => {
            let res = match quality.as_str() {
                "720p"  => "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]",
                "1080p" => "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]",
                "1440p" => "bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440][ext=mp4]",
                "2160p" => "bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160][ext=mp4]",
                _       => "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]",
            };
            args.extend([
                "-f".into(), res.into(),
                "--merge-output-format".into(), "mp4".into(),
            ]);
        }
        "webm" => {
            let res = match quality.as_str() {
                "720p"  => "bestvideo[height<=720][ext=webm]+bestaudio[ext=webm]/best[height<=720]",
                "1080p" => "bestvideo[height<=1080][ext=webm]+bestaudio[ext=webm]/best[height<=1080]",
                "1440p" => "bestvideo[height<=1440][ext=webm]+bestaudio[ext=webm]/best[height<=1440]",
                "2160p" => "bestvideo[height<=2160][ext=webm]+bestaudio[ext=webm]/best[height<=2160]",
                _       => "bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio",
            };
            args.extend(["-f".into(), res.into()]);
        }
        _ => {
            args.extend(["-f".into(), "bestvideo+bestaudio".into()]);
        }
    }

    args.push(url);

    let mut child = std::process::Command::new("yt-dlp")
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            app.emit("download-progress", &line).ok();
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("yt-dlp завершился с ошибкой".into());
    }

    app.emit("download-done", ()).ok();
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_video_info, download_video])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}