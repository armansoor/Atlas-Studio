/* =========================================================
   Atlas Studio Pro — Fully Client-Side File → Website
   - PDF (pdf.js) text extraction + optional page render
   - DOCX (mammoth) → HTML
   - Markdown (marked) → HTML
   - CSV (PapaParse) → HTML table
   - TXT/JSON → <pre> / pretty table
   - Images → OCR (Tesseract) + embed
   - Build preview, TOC, analytics, themes
   - Export: single HTML, split assets, multipage ZIP
   - Save/Load project to localStorage
   ========================================================= */
(() => {
  "use strict";

  /* ---------- tiny helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const human = (n) => { const u = ["B","KB","MB","GB"]; let i=0; while(n>1024&&i<u.length-1){ n/=1024; i++; } return `${n.toFixed(1)} ${u[i]}`; };
  const fileToDataURL = (f) => new Promise((res, rej) => { const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f); });

  /* ---------- state ---------- */
  const state = {
    files: [],   // {id, file, name, type, size}
    pages: [],   // {id, title, html}
    settings: {splitPdf:true, renderPdfImage:false, ocrLang:'eng', buildToc:true},
    seo: {title:'Generated Site', desc:'Built with Atlas Studio Pro', theme:'#0b0d12'},
    stats: {pages:0, words:0, chars:0, images:0},
    editable: false
  };

  /* ---------- DOM ---------- */
  const preview = $("#preview");
  const tocList = $("#tocList");
  const recentList = $("#recentList");
  const queueList = $("#queue");
  const projectMeta = $("#projectMeta");
  const chartCanvas = $("#chartWords");

  /* ---------- init ---------- */
  function setTheme(key) {
    document.body.classList.remove("theme-light","theme-sepia","theme-solar","theme-emerald");
    if (key === "light") document.body.classList.add("theme-light");
    if (key === "sepia") document.body.classList.add("theme-sepia");
    if (key === "solar") document.body.classList.add("theme-solar");
    if (key === "emerald") document.body.classList.add("theme-emerald");
  }
  setTheme("midnight");

  $("#themeSelect").addEventListener("change", e => setTheme(e.target.value));
  $("#primaryColor").addEventListener("input", e => {
    document.documentElement.style.setProperty("--brand", e.target.value);
  });
  $("#fontSelect").addEventListener("change", e => {
    document.body.style.fontFamily = e.target.value;
  });

  // keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); toggleEdit(); }
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); exportZip(); }
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); $("#searchProject").focus(); }
    if (e.key === "?") { e.preventDefault(); alert("Shortcuts:\nCtrl/⌘+E: Toggle Edit\nCtrl/⌘+S: Export ZIP\nCtrl/⌘+K: Search Project"); }
  });

  $("#btnShortcuts").addEventListener("click", () => alert("Shortcuts:\nCtrl/⌘+E: Toggle Edit\nCtrl/⌘+S: Export ZIP\nCtrl/⌘+K: Search Project"));

  /* ---------- file input / DnD ---------- */
  const drop = $("#dropzone");
  ["dragenter","dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave","drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    enqueue(files);
  });
  $("#fileInput").addEventListener("change", (e) => {
    enqueue(Array.from(e.target.files || []));
    e.target.value = "";
  });
  $("#btnQueueClear").addEventListener("click", () => { state.files = []; queueList.innerHTML = ""; updateMeta(); });

  function enqueue(files) {
    for (const f of files) {
      const id = uid();
      state.files.push({id, file: f, name: f.name, type: f.type || "", size: f.size});
      const item = document.createElement("div");
      item.className = "item";
      item.id = `q-${id}`;
      item.innerHTML = `
        <div>
          <div class="name">${esc(f.name)}</div>
          <div class="muted small">${esc(f.type || "unknown")} • ${human(f.size)}</div>
        </div>
        <div class="progress"><i id="bar-${id}"></i></div>
      `;
      queueList.appendChild(item);

      const rec = document.createElement("div");
      rec.className = "item";
      rec.textContent = f.name;
      recentList.prepend(rec);
    }
    updateMeta();
  }
  function bump(id, pct){ const bar = $(`#bar-${id}`); if(bar) bar.style.width = Math.min(100, Math.max(0, pct)) + "%"; }

  /* ---------- convert pipeline ---------- */
  $("#btnConvert").addEventListener("click", async () => {
    if (!state.files.length) return alert("Add files first.");
    // load settings
    state.settings.splitPdf = $("#optSplitPdf").checked;
    state.settings.renderPdfImage = $("#optRenderPdfImage").checked;
    state.settings.ocrLang = $("#ocrLang").value;
    state.settings.buildToc = $("#optBuildToc").checked;

    // reset pages/stats
    state.pages = [];
    state.stats = {pages:0, words:0, chars:0, images:0};

    for (const entry of state.files) {
      await processFile(entry);
    }
    buildTOC();
    renderPreview();
    updateAnalytics();
  });

  async function processFile(entry) {
    try {
      const { id, file, name } = entry;
      bump(id, 5);
      const mt = (entry.type || "").toLowerCase();
      const lower = name.toLowerCase();

      // PDF
      if (mt.includes("pdf") || lower.endsWith(".pdf")) {
        const buf = await file.arrayBuffer(); bump(id, 15);
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise; bump(id, 22);
        const pages = pdf.numPages;

        for (let p = 1; p <= pages; p++) {
          const page = await pdf.getPage(p);
          const textContent = await page.getTextContent();
          const text = textContent.items.map(i => i.str).join(" ");
          let html = `<article><h1>${esc(name)} — Page ${p}</h1><section>${esc(text)}</section>`;
          if (state.settings.renderPdfImage) {
            const viewport = page.getViewport({ scale: 1.5 });
            const c = document.createElement("canvas");
            c.width = viewport.width; c.height = viewport.height;
            const ctx = c.getContext("2d");
            await page.render({ canvasContext: ctx, viewport }).promise;
            html += `<figure><img src="${c.toDataURL("image/png")}" alt="${esc(name)} p${p}" loading="lazy"></figure>`;
            state.stats.images++;
          }
          html += `</article>`;
          pushPage({ title: `${name} — Page ${p}`, html });
          bump(id, 22 + Math.round((p/pages)*70));
          if (!state.settings.splitPdf) break;
        }
        bump(id, 100);
        return;
      }

      // DOCX
      if (mt.includes("word") || lower.endsWith(".docx")) {
        const ab = await file.arrayBuffer(); bump(id, 25);
        const res = await mammoth.convertToHtml(
          { arrayBuffer: ab },
          { convertImage: mammoth.images.inline() }
        );
        pushPage({ title: name, html: `<article>${res.value}</article>` });
        bump(id, 100);
        return;
      }

      // Markdown
      if (lower.endsWith(".md")) {
        const txt = await file.text(); bump(id, 30);
        const md = marked.parse(txt);
        pushPage({ title: name, html: `<article class="md">${md}</article>` });
        bump(id, 100);
        return;
      }

      // CSV
      if (lower.endsWith(".csv")) {
        const txt = await file.text(); bump(id, 30);
        const parsed = Papa.parse(txt, { header: true });
        const headers = parsed.meta.fields || [];
        const rows = parsed.data || [];
        const table = `
          <table>
            <thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead>
            <tbody>
              ${rows.map(r=>`<tr>${headers.map(h=>`<td>${esc(String(r[h] ?? ""))}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        `;
        pushPage({ title: name, html: `<article><h1>${esc(name)}</h1>${table}</article>` });
        bump(id, 100);
        return;
      }

      // Images → OCR
      if (mt.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(lower)) {
        const dataUrl = await fileToDataURL(file); bump(id, 25);
        const worker = Tesseract.createWorker();
        await worker.load(); await worker.loadLanguage(state.settings.ocrLang); await worker.initialize(state.settings.ocrLang);
        const { data: { text } } = await worker.recognize(file);
        await worker.terminate();
        pushPage({
          title: name,
          html: `<article><h1>${esc(name)}</h1><img src="${dataUrl}" alt="${esc(name)}" loading="lazy"/><pre>${esc(text)}</pre></article>`
        });
        state.stats.images++;
        bump(id, 100);
        return;
      }

      // TXT / JSON / everything else
      const txt = await file.text(); bump(id, 55);
      let html;
      if (lower.endsWith(".json")) {
        try {
          const obj = JSON.parse(txt);
          const keys = Object.keys(obj);
          html = `<article><h1>${esc(name)}</h1><pre>${esc(JSON.stringify(obj, null, 2))}</pre></article>`;
        } catch {
          html = `<article><h1>${esc(name)}</h1><pre>${esc(txt)}</pre></article>`;
        }
      } else {
        html = `<article><h1>${esc(name)}</h1><pre>${esc(txt)}</pre></article>`;
      }
      pushPage({ title: name, html });
      bump(id, 100);
    } catch (err) {
      console.error("processFile error:", err);
      alert(`Error processing ${entry?.name || "file"}: ${err?.message || err}`);
    }
  }

  function pushPage({ title, html }) {
    state.pages.push({ id: uid(), title, html });
    const plain = html.replace(/<[^>]+>/g, " ");
    state.stats.pages = state.pages.length;
    state.stats.words += (plain.trim().match(/\S+/g) || []).length;
    state.stats.chars += plain.length;
  }

  /* ---------- build TOC & preview ---------- */
  function buildTOC() {
    tocList.innerHTML = "";
    state.pages.forEach((p, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<a href="#" data-idx="${i}">${esc(p.title)}</a>`;
      li.querySelector("a").addEventListener("click", (e) => {
        e.preventDefault(); scrollPreviewTo(i);
      });
      tocList.appendChild(li);
    });
    updateMeta();
  }

  function renderPreview() {
    const html = buildSiteHtml({ inline: true });
    preview.srcdoc = html;
    preview.onload = () => { if (state.editable) enableEditing(true); };
  }

  function baseSiteCss() {
    const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand") || "#6a8dff";
    return `
:root{--brand:${brand}}
*{box-sizing:border-box}
html,body{margin:0}
body{font-family:Inter,system-ui,Arial,sans-serif;background:#0b0d12;color:#e9eef8}
a{color:#9ec1ff}
main{max-width:1100px;margin:24px auto;padding:0 16px}
.page{background:rgba(255,255,255,.02);padding:18px;border-radius:12px;margin-bottom:18px;border:1px solid rgba(255,255,255,.06)}
img{max-width:100%;height:auto;border-radius:8px;border:1px solid rgba(255,255,255,.06)}
pre{white-space:pre-wrap;background:rgba(255,255,255,.04);padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,.06)}
table{width:100%;border-collapse:collapse;overflow:auto;display:block}
th,td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)}
.site{display:grid;grid-template-columns:260px 1fr;gap:18px}
@media (max-width: 900px){.site{grid-template-columns:1fr}}
.site-toc{position:sticky;top:16px;height:fit-content;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:10px}
.site-toc ul{list-style:none;margin:0;padding:0}
.site-toc a{display:block;padding:8px;border-radius:8px;color:#e9eef8;text-decoration:none}
.site-toc a.active,.site-toc a:hover{background:rgba(255,255,255,.06)}
.hl{background:rgba(255,255,0,.25)}
`;
  }

  function baseSiteJs() {
    return `(()=>{"use strict";
const tocLinks=[...document.querySelectorAll(".site-toc a")];
tocLinks.forEach(a=>a.addEventListener("click",e=>{e.preventDefault();const id=a.getAttribute("href").slice(1);document.getElementById(id)?.scrollIntoView({behavior:"smooth"});}));
const obs=new IntersectionObserver(entries=>{entries.forEach(en=>{if(en.isIntersecting){const id=en.target.id;tocLinks.forEach(a=>a.classList.toggle("active",a.getAttribute("href")==="#"+id));}})},{rootMargin:"-40% 0px -55% 0px"});
document.querySelectorAll(".page").forEach(p=>obs.observe(p));
})();`;
  }

  function buildSiteHtml({ inline = false } = {}) {
    const pagesHtml = state.pages.map((p,i)=>`<section id="p-${i}" class="page">${p.html}</section>`).join("\n");
    const tocHtml = state.settings.buildToc
      ? `<aside class="site-toc"><ul>${state.pages.map((p,i)=>`<li><a href="#p-${i}">${esc(p.title)}</a></li>`).join("")}</ul></aside>`
      : "";
    const css = baseSiteCss();
    const js = baseSiteJs();
    const meta = `
<meta name="description" content="${esc(state.seo.desc)}">
<meta name="theme-color" content="${esc(state.seo.theme)}">
`;
    return `
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${meta}
<title>${esc(state.seo.title)}</title>${inline?`<style>${css}</style>`:'<link rel="stylesheet" href="styles.css">'}
</head><body>
<main class="site">
  ${tocHtml}
  <div class="site-content">${pagesHtml}</div>
</main>
${inline?`<script>${js}<\/script>`:'<script src="script.js"></script>'}
</body></html>`;
  }

  function scrollPreviewTo(i) {
    const doc = preview.contentDocument || preview.contentWindow.document;
    const el = doc.getElementById(`p-${i}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateMeta() {
    projectMeta.textContent = `${state.files.length} files · ${state.pages.length} pages`;
  }

  /* ---------- edit & find ---------- */
  $("#btnToggleEdit").addEventListener("click", toggleEdit);
  function toggleEdit() {
    const doc = preview.contentDocument || preview.contentWindow.document;
    if (!doc) return;
    state.editable = !state.editable;
    doc.body.contentEditable = state.editable ? "true" : "false";
    $("#status").textContent = state.editable ? "Edit mode ON" : "Ready";
  }

  $("#btnFind").addEventListener("click", () => {
    const q = prompt("Find text in preview:");
    if (!q) return;
    const doc = preview.contentDocument || preview.contentWindow.document;
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(safe, "gi");
    doc.body.innerHTML = doc.body.innerHTML.replace(/<mark class="hl">([\s\S]*?)<\/mark>/g, "$1");
    doc.body.innerHTML = doc.body.innerHTML.replace(rx, (m) => `<mark class="hl">${m}</mark>`);
  });

  /* ---------- analytics ---------- */
  $("#btnAnalytics").addEventListener("click", updateAnalytics);
  function updateAnalytics() {
    $("#analytics").textContent = `${state.stats.pages} pages • ${state.stats.words} words • ${state.stats.chars} chars • ${state.stats.images} images`;
    try { window._chart?.destroy(); } catch {}
    const ctx = chartCanvas.getContext("2d");
    const words = state.pages.map(p => (p.html.replace(/<[^>]+>/g," ").trim().match(/\S+/g)||[]).length);
    window._chart = new Chart(ctx, {
      type: "bar",
      data: { labels: state.pages.map((_,i)=>`P${i+1}`), datasets: [{ label: "Words", data: words }] },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }

  /* ---------- export ZIP ---------- */
  $("#btnExport").addEventListener("click", exportZip);
  async function exportZip() {
    if (!state.pages.length) return alert("Nothing to export. Convert files first.");
    const mode = $("#exportMode").value;
    const zip = new JSZip();

    if (mode === "single") {
      zip.file("index.html", buildSiteHtml({ inline: true }));
    } else if (mode === "split") {
      zip.file("index.html", buildSiteHtml({ inline: false }));
      zip.file("styles.css", baseSiteCss());
      zip.file("script.js", baseSiteJs());
    } else {
      // multipage
      zip.file("styles.css", baseSiteCss());
      zip.file("script.js", baseSiteJs());
      zip.file("index.html", buildMultipageIndex());
      state.pages.forEach((p, i) => {
        zip.file(`pages/page-${i+1}.html`, buildSinglePage(p, i));
      });
    }

    if ($("#pwaMode").value === "basic") {
      const { iconData, manifest, sw } = await genPwa();
      zip.file("manifest.webmanifest", JSON.stringify(manifest, null, 2));
      zip.file("sw.js", sw);
      zip.folder("icons").file("icon-512.png", iconData.split(",")[1], { base64: true });
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "atlas-site.zip";
    a.click();
  }

  function buildMultipageIndex() {
    const meta = `<meta name="description" content="${esc(state.seo.desc)}">`;
    const first = state.pages[0]?.html || "<article><h1>Welcome</h1></article>";
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${meta}<title>${esc(state.seo.title)}</title><link rel="stylesheet" href="styles.css"></head><body><main class="site"><div class="site-content">${first}</div></main><script src="script.js"></script></body></html>`;
  }
  function buildSinglePage(p, i) {
    const meta = `<meta name="description" content="${esc(state.seo.desc)}">`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${meta}<title>${esc(p.title)}</title><link rel="stylesheet" href="../styles.css"></head><body><main class="site"><div class="site-content"><section class="page" id="p-${i}">${p.html}</section></div></main><script src="../script.js"></script></body></html>`;
  }

  async function genPwa() {
    const size = 512;
    const c = document.createElement("canvas"); c.width = c.height = size;
    const ctx = c.getContext("2d");
    const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand") || "#6a8dff";
    ctx.fillStyle = brand.trim(); ctx.fillRect(0,0,size,size);
    ctx.fillStyle = "#fff"; ctx.font = "bold 340px Inter, sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("A", size/2, size/2+30);
    const png = c.toDataURL("image/png");
    const manifest = { name: state.seo.title || "Atlas Site", short_name: "Atlas", start_url: ".", background_color: state.seo.theme, theme_color: state.seo.theme, display: "standalone", icons: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }] };
    const sw = `self.addEventListener('install', e=>{self.skipWaiting();e.waitUntil(caches.open('atlas-v1').then(c=>c.addAll(['./','./index.html','./styles.css'])))});self.addEventListener('fetch', e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))})`;
    return { iconData: png, manifest, sw };
  }

  /* ---------- save / load / new ---------- */
  $("#btnSave").addEventListener("click", () => {
    const payload = {
      files: state.files.map(f => ({ name: f.name, size: f.size, type: f.type })),
      pages: state.pages,
      settings: state.settings,
      seo: state.seo
    };
    localStorage.setItem("atlasProject", JSON.stringify(payload));
    alert("Project saved to localStorage.");
  });
  $("#btnLoad").addEventListener("click", () => {
    const raw = localStorage.getItem("atlasProject");
    if (!raw) return alert("No saved project found.");
    const data = JSON.parse(raw);
    state.pages = data.pages || [];
    state.settings = data.settings || state.settings;
    state.seo = data.seo || state.seo;
    buildTOC(); renderPreview(); updateAnalytics();
  });
  $("#btnNew").addEventListener("click", () => {
    if (!confirm("Start a new project?")) return;
    state.files = []; state.pages = [];
    queueList.innerHTML = ""; recentList.innerHTML = ""; tocList.innerHTML = "";
    renderPreview(); updateAnalytics(); updateMeta();
  });

  /* ---------- Build button (rebuild preview with current SEO/flags) ---------- */
  $("#btnBuild").addEventListener("click", () => {
    state.seo.title = $("#siteTitle").value || "Generated Site";
    state.seo.desc  = $("#siteDesc").value || "Built with Atlas Studio Pro";
    renderPreview();
  });

  /* ---------- initial ---------- */
  renderPreview();
  updateAnalytics();
  updateMeta();
})();
