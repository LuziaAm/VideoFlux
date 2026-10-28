// FluxVideo — frontend (JS puro, sem build)

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  project: null,
  /** @type {{index:number, prompt:string, motion:string, duration:string, image_path?:string, image_url?:string, video_url?:string, busy?:string}[]} */
  scenes: [],
};

// ---------- utilidades ----------

const slugify = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "default";

const pad = (n) => String(n).padStart(2, "0");
const sceneIndexOf = (p) => Number(p.match(/scene_(\d+)\./)?.[1]);

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), isError ? 8000 : 3500);
}

async function withLoading(btn, fn) {
  btn.disabled = true;
  btn.classList.add("loading");
  try { return await fn(); }
  finally { btn.disabled = false; btn.classList.remove("loading"); }
}

// ---------- persistência dos prompts (localStorage) ----------

const storeKey = (p) => `fluxvideo:${p}`;
function saveDrafts() {
  if (!state.project) return;
  const drafts = state.scenes.map(({ index, prompt, motion, duration }) => ({ index, prompt, motion, duration }));
  localStorage.setItem(storeKey(state.project), JSON.stringify(drafts));
}
function loadDrafts(project) {
  try { return JSON.parse(localStorage.getItem(storeKey(project)) || "[]"); }
  catch { return []; }
}

// ---------- status / projetos ----------

async function loadStatus() {
  try {
    const c = await api("/api/config");
    $("#status").innerHTML = `
      <span class="chip ${c.hasOpenAiKey ? "" : "off"}" title="Chave OpenAI">${c.imageModel}</span>
      <span class="chip ${c.hasVideoKey ? "" : "off"}" title="${c.videoModel}">${c.videoProvider}</span>`;
  } catch {
    $("#status").innerHTML = `<span class="chip off">servidor offline</span>`;
  }
}

async function loadProjects() {
  const { projects } = await api("/api/projects");
  const nav = $("#project-list");
  nav.innerHTML = "";
  if (!projects.length) nav.innerHTML = `<p class="muted" style="padding:0 10px">Nenhum ainda.</p>`;
  for (const name of projects) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = `project-${name}`;
    b.textContent = name;
    b.classList.toggle("active", name === state.project);
    b.onclick = () => openProject(name);
    nav.appendChild(b);
  }
}

async function openProject(name) {
  const data = await api(`/api/projects/${encodeURIComponent(name)}`);
  state.project = data.project;
  localStorage.setItem("fluxvideo:last", state.project);

  // Mescla rascunhos salvos com arquivos existentes em disco.
  const byIndex = new Map();
  for (const d of loadDrafts(state.project)) byIndex.set(d.index, { ...d });
  const ensure = (i) => byIndex.get(i) ?? byIndex.set(i, { index: i, prompt: "", motion: "", duration: "5" }).get(i);
  for (const img of data.images) Object.assign(ensure(sceneIndexOf(img.path)), { image_path: img.path, image_url: img.url });
  for (const vid of data.videos) Object.assign(ensure(sceneIndexOf(vid.path)), { video_url: vid.url });
  if (!byIndex.size) ensure(1);

  state.scenes = [...byIndex.values()].sort((a, b) => a.index - b.index);

  $("#empty-state").hidden = true;
  $("#workspace").hidden = false;
  $("#project-title").textContent = state.project;
  renderScenes();
  renderFinals(data.finals);
  await loadProjects();
}

// ---------- render ----------

function renderMeta() {
  const imgs = state.scenes.filter((s) => s.image_url).length;
  const vids = state.scenes.filter((s) => s.video_url).length;
  $("#project-meta").textContent = `${state.scenes.length} cena(s) · ${imgs} imagem(ns) · ${vids} clipe(s)`;
}

function fillSlot(slot, kind, url, busy) {
  slot.classList.toggle("busy", Boolean(busy));
  slot.classList.toggle("filled", Boolean(url));
  if (url) {
    slot.innerHTML = kind === "image"
      ? `<img src="${url}" alt="Keyframe" loading="lazy" />`
      : `<video src="${url}" muted loop playsinline preload="metadata"></video>`;
    const v = $("video", slot);
    if (v) { slot.onmouseenter = () => v.play(); slot.onmouseleave = () => v.pause(); }
  } else {
    slot.innerHTML = `<span>${busy ? "Gerando…" : kind === "image" ? "Keyframe" : "Clipe"}</span>`;
  }
}

function renderScene(scene) {
  const el = $("#scene-template").content.firstElementChild.cloneNode(true);
  el.id = `scene-${scene.index}`;
  $(".scene-num", el).textContent = `Cena ${pad(scene.index)}`;

  const prompt = $(".prompt", el), motion = $(".motion", el), duration = $(".duration", el);
  prompt.value = scene.prompt;
  motion.value = scene.motion;
  duration.value = scene.duration || "5";
  prompt.oninput = () => { scene.prompt = prompt.value; saveDrafts(); };
  motion.oninput = () => { scene.motion = motion.value; saveDrafts(); };
  duration.onchange = () => { scene.duration = duration.value; saveDrafts(); };

  fillSlot($(".image-slot", el), "image", scene.image_url, scene.busy === "image");
  fillSlot($(".video-slot", el), "video", scene.video_url, scene.busy === "video");

  const btnImage = $(".btn-image", el), btnVideo = $(".btn-video", el);
  btnImage.id = `scene-${scene.index}-image-btn`;
  btnVideo.id = `scene-${scene.index}-video-btn`;
  btnImage.textContent = scene.image_url ? "Regerar imagem" : "Gerar imagem";
  btnVideo.disabled = !scene.image_path;
  btnImage.onclick = () => withLoading(btnImage, () => genImage(scene)).catch(() => {});
  btnVideo.onclick = () => withLoading(btnVideo, () => genVideo(scene)).catch(() => {});

  const remove = $(".btn-remove", el);
  remove.hidden = Boolean(scene.image_url || scene.video_url); // só remove rascunhos sem arquivos
  remove.onclick = () => {
    state.scenes = state.scenes.filter((s) => s !== scene);
    saveDrafts();
    renderScenes();
  };
  return el;
}

function renderScenes() {
  const root = $("#scenes");
  root.innerHTML = "";
  state.scenes.forEach((s) => root.appendChild(renderScene(s)));
  renderMeta();
}

function rerenderScene(scene) {
  const old = $(`#scene-${scene.index}`);
  if (old) old.replaceWith(renderScene(scene));
  renderMeta();
}

function renderFinals(finals) {
  $("#final-section").hidden = !finals.length;
  $("#finals").innerHTML = finals.map((f) => {
    const name = f.path.split(/[\\/]/).pop();
    return `<div class="final-card">
      <video src="${f.url}" controls playsinline preload="metadata"></video>
      <a href="${f.url}" download="${name}">⬇ ${name}</a>
    </div>`;
  }).join("");
}

// ---------- ações ----------

async function genImage(scene) {
  if (!scene.prompt.trim()) { toast("Escreva o prompt da imagem primeiro.", true); throw new Error("sem prompt"); }
  scene.busy = "image"; rerenderScene(scene);
  try {
    const r = await api("/api/image", { project: state.project, scene_index: scene.index, prompt: scene.prompt });
    Object.assign(scene, { image_path: r.image_path, image_url: r.url });
    toast(`Cena ${pad(scene.index)}: imagem gerada.`);
  } catch (e) {
    toast(`Cena ${pad(scene.index)}: ${e.message}`, true);
    throw e;
  } finally {
    scene.busy = null; rerenderScene(scene);
  }
}

async function genVideo(scene) {
  if (!scene.motion.trim()) { toast("Descreva o movimento de câmera primeiro.", true); throw new Error("sem motion"); }
  scene.busy = "video"; rerenderScene(scene);
  try {
    const r = await api("/api/video", {
      project: state.project, scene_index: scene.index, image_path: scene.image_path,
      motion_prompt: scene.motion, duration: scene.duration,
    });
    scene.video_url = r.url;
    toast(`Cena ${pad(scene.index)}: clipe pronto.`);
  } catch (e) {
    toast(`Cena ${pad(scene.index)}: ${e.message}`, true);
    throw e;
  } finally {
    scene.busy = null; rerenderScene(scene);
  }
}

async function assemble() {
  const r = await api("/api/assemble", { project: state.project });
  toast(`Vídeo final montado com ${r.clips.length} clipe(s).`);
  const data = await api(`/api/projects/${encodeURIComponent(state.project)}`);
  renderFinals(data.finals);
  $("#final-section").scrollIntoView({ behavior: "smooth" });
}

/** Gera o que falta em cada cena, em sequência, e monta o final. */
async function runAll() {
  for (const s of state.scenes) {
    if (!s.image_path) await genImage(s);
    if (!s.video_url) await genVideo(s);
  }
  await assemble();
}

// ---------- eventos ----------

$("#new-project-form").onsubmit = async (e) => {
  e.preventDefault();
  const input = $("#new-project-input");
  const name = input.value.trim();
  if (!name) return;
  input.value = "";
  await openProject(slugify(name)).catch((err) => toast(err.message, true));
};

$("#add-scene-btn").onclick = () => {
  const next = Math.max(0, ...state.scenes.map((s) => s.index)) + 1;
  state.scenes.push({ index: next, prompt: "", motion: "", duration: "5" });
  saveDrafts();
  renderScenes();
  $(`#scene-${next} .prompt`)?.focus();
};

$("#refresh-btn").onclick = (e) =>
  withLoading(e.currentTarget, () => openProject(state.project)).catch((err) => toast(err.message, true));

$("#assemble-btn").onclick = (e) =>
  withLoading(e.currentTarget, assemble).catch((err) => toast(err.message, true));

$("#run-all-btn").onclick = (e) =>
  withLoading(e.currentTarget, runAll).catch(() => {}); // erros já exibidos por cena

// ---------- init ----------

await loadStatus();
await loadProjects();
const last = localStorage.getItem("fluxvideo:last");
if (last) openProject(last).catch(() => {});
