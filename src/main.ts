import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

let currentUrl = "";

// Настройки папок 
const dirs: Record<string, string> = {
  mp3:  localStorage.getItem("dir-mp3")  ?? "~/Music",
  opus: localStorage.getItem("dir-opus") ?? "~/Music",
  mp4:  localStorage.getItem("dir-mp4")  ?? "~/Videos",
  webm: localStorage.getItem("dir-webm") ?? "~/Videos",
};

interface HistoryItem { title: string; format: string; time: string; }
const history: HistoryItem[] = [];

// Элементы
const urlInput      = document.getElementById("url-input")       as HTMLInputElement;
const fetchBtn      = document.getElementById("fetch-btn")        as HTMLButtonElement;
const downloadBtn   = document.getElementById("download-btn")     as HTMLButtonElement;
const videoPreview  = document.getElementById("video-preview")    as HTMLDivElement;
const progressSection = document.getElementById("progress-section") as HTMLDivElement;
const progressBar   = document.getElementById("progress-bar")     as HTMLDivElement;
const progressText  = document.getElementById("progress-text")    as HTMLSpanElement;
const statusText    = document.getElementById("status-text")      as HTMLSpanElement;
const historyList   = document.getElementById("history-list")     as HTMLDivElement;

// Вкладки
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = (btn as HTMLElement).dataset.tab!;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${tab}`)!.classList.add("active");
  });
});

// Загружаем пути в настройки
function loadSettingsUI() {
  (document.getElementById("dir-mp3")  as HTMLInputElement).value = dirs.mp3;
  (document.getElementById("dir-opus") as HTMLInputElement).value = dirs.opus;
  (document.getElementById("dir-mp4")  as HTMLInputElement).value = dirs.mp4;
  (document.getElementById("dir-webm") as HTMLInputElement).value = dirs.webm;
}
loadSettingsUI();

// Кнопки "обзор" в настройках
document.querySelectorAll(".pick-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const target = (btn as HTMLElement).dataset.target!;
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      (document.getElementById(target) as HTMLInputElement).value = selected as string;
    }
  });
});

// Сохранить настройки
document.getElementById("save-settings-btn")!.addEventListener("click", () => {
  dirs.mp3  = (document.getElementById("dir-mp3")  as HTMLInputElement).value;
  dirs.opus = (document.getElementById("dir-opus") as HTMLInputElement).value;
  dirs.mp4  = (document.getElementById("dir-mp4")  as HTMLInputElement).value;
  dirs.webm = (document.getElementById("dir-webm") as HTMLInputElement).value;

  localStorage.setItem("dir-mp3",  dirs.mp3);
  localStorage.setItem("dir-opus", dirs.opus);
  localStorage.setItem("dir-mp4",  dirs.mp4);
  localStorage.setItem("dir-webm", dirs.webm);

  const btn = document.getElementById("save-settings-btn")!;
  btn.textContent = "сохранено!";
  setTimeout(() => btn.textContent = "сохранить", 1500);
});

// Чипы качества по формату
const audioChips = [
  { q: "128", label: "128 kbps" },
  { q: "320", label: "320 kbps" },
  { q: "lossless", label: "lossless" },
];
const videoChips = [
  { q: "720p",  label: "720p" },
  { q: "1080p", label: "1080p" },
  { q: "1440p", label: "1440p" },
  { q: "2160p", label: "4K" },
];

function renderQualityChips(fmt: string) {
  const chips = document.getElementById("quality-chips")!;
  const isAudio = fmt === "mp3" || fmt === "opus";
  const list = isAudio ? audioChips : videoChips;
  chips.innerHTML = list.map((c, i) => `
    <span class="q-chip ${i === 1 ? "active" : ""}" data-q="${c.q}">${c.label}</span>
  `).join("");
  chips.querySelectorAll(".q-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      chips.querySelectorAll(".q-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
    });
  });
}

// Кнопки формата
document.querySelectorAll(".fmt-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".fmt-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderQualityChips((btn as HTMLElement).dataset.fmt ?? "mp3");
  });
});

renderQualityChips("mp3"); 

// Поиск видео
fetchBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return;
  currentUrl = url;
  fetchBtn.textContent = "загружаю...";
  fetchBtn.disabled = true;
  statusText.textContent = "";

  try {
    const info = await invoke<{
      title: string; duration: number; uploader: string; thumbnail: string;
    }>("get_video_info", { url });

    const mins = Math.floor(info.duration / 60);
    const secs = String(Math.floor(info.duration % 60)).padStart(2, "0");

    videoPreview.innerHTML = `
      <img src="${info.thumbnail}" style="width:80px;height:50px;object-fit:cover;border-radius:6px;flex-shrink:0" />
      <div>
        <div class="preview-title">${info.title}</div>
        <div class="preview-meta">${info.uploader ?? "—"} · ${mins}:${secs}</div>
      </div>`;
    videoPreview.style.display = "flex";
    downloadBtn.disabled = false;
  } catch (e) {
    statusText.textContent = `ошибка: ${e}`;
  } finally {
    fetchBtn.textContent = "найти";
    fetchBtn.disabled = false;
  }
});

// Скачивание
downloadBtn.addEventListener("click", async () => {
  const fmt = (document.querySelector(".fmt-btn.active") as HTMLElement)?.dataset.fmt ?? "mp3";
  const quality = (document.querySelector(".q-chip.active") as HTMLElement)?.dataset.q ?? "320";


  const outputDir = dirs[fmt] ?? "~/Downloads";

  progressSection.style.display = "block";
  progressBar.style.width = "0%";
  progressText.textContent = "0%";
  statusText.textContent = "";
  downloadBtn.disabled = true;

  const unlistenProgress = await listen<string>("download-progress", (e) => {
    const match = e.payload.match(/(\d+\.?\d*)%.*?at\s+([\d.]+\S+\/s)/);
    if (match) {
      progressBar.style.width = `${match[1]}%`;
      progressText.textContent = `${match[1]}%  ·  ${match[2]}`;
    }
  });

  const unlistenDone = await listen("download-done", () => {
    progressBar.style.width = "100%";
    progressText.textContent = "100%";
    statusText.textContent = `готово! сохранено в ${outputDir}`;
    downloadBtn.disabled = false;
    addHistory(fmt);
    unlistenProgress();
    unlistenDone();
  });

  try {
    await invoke("download_video", { url: currentUrl, format: fmt, quality, outputDir });
  } catch (e) {
    statusText.textContent = `ошибка: ${e}`;
    downloadBtn.disabled = false;
    unlistenProgress();
    unlistenDone();
  }
});

function addHistory(fmt: string) {
  const title = (videoPreview.querySelector(".preview-title") as HTMLElement)?.textContent ?? "Видео";
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  history.unshift({ title, format: fmt.toUpperCase(), time });
  renderHistory();
}

function renderHistory() {
  if (history.length === 0) {
    historyList.innerHTML = `<div class="empty-hist">пока пусто</div>`;
    return;
  }
  historyList.innerHTML = history.map(h => `
    <div class="hist-item">
      <div class="hist-icon ${h.format.toLowerCase()}">${h.format}</div>
      <div>
        <div class="hist-name">${h.title}</div>
        <div class="hist-meta">${h.format} · ${h.time}</div>
      </div>
    </div>
  `).join("");
}