const API_BASE = ""; // Same protected hostname; /api/* must be routed to the separate Admin API Worker.
const ADMIN_EMAIL = "shashank77a@gmail.com";
const $ = (id) => document.getElementById(id);
const state = { drafts: [], currentId: null, timer: null, saving: false, dirty: false, lastSaved: null, analyticsLoading: false };
const pageNames = { dashboard: "Dashboard", drafts: "Drafts", editor: "लेख Editor", analytics: "Analytics" };


const SAFE_EDITOR_TAGS = new Set(["H2","H3","P","UL","OL","LI","STRONG","B","EM","I","BLOCKQUOTE","FIGURE","IMG","FIGCAPTION","A","BR","HR","CODE","PRE","SPAN"]);
function sanitizeRichHtml(input) {
  const parsed = new DOMParser().parseFromString(String(input || ""), "text/html");
  function clean(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
    if (node.nodeType !== Node.ELEMENT_NODE || !SAFE_EDITOR_TAGS.has(node.tagName)) {
      const fragment = document.createDocumentFragment();
      node.childNodes?.forEach((child) => fragment.append(clean(child)));
      return fragment;
    }
    const safe = document.createElement(node.tagName.toLowerCase());
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") || "";
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(src)) return document.createDocumentFragment();
      safe.setAttribute("src", src);
      safe.setAttribute("alt", (node.getAttribute("alt") || "").slice(0, 180));
      safe.setAttribute("loading", "lazy");
    } else if (node.tagName === "A") {
      const href = node.getAttribute("href") || "";
      if (/^https:\/\//i.test(href)) {
        safe.setAttribute("href", href);
        safe.setAttribute("rel", "noopener noreferrer");
        safe.setAttribute("target", "_blank");
        if (node.classList.contains("article-button")) safe.setAttribute("class", "article-button");
      }
    }
    node.childNodes.forEach((child) => safe.append(clean(child)));
    return safe;
  }
  const out = document.createDocumentFragment();
  parsed.body.childNodes.forEach((node) => out.append(clean(node)));
  const container = document.createElement("div");
  container.append(out);
  return container.innerHTML;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}
function showMessage(message, kind = "error") {
  const node = $("global-message");
  node.textContent = message;
  node.className = `message ${kind}`;
  node.classList.remove("hidden");
}
function hideMessage() { $("global-message").classList.add("hidden"); }
function setSaveState(label, kind = "") {
  const node = $("save-state");
  node.textContent = label;
  node.className = `save-state ${kind}`.trim();
}
function showPage(page) {
  document.querySelectorAll(".page").forEach((section) => section.classList.toggle("active", section.id === `page-${page}`));
  document.querySelectorAll("[data-page]").forEach((button) => {
    if (button.classList.contains("nav-link")) button.classList.toggle("active", button.dataset.page === page);
  });
  $("page-title").textContent = pageNames[page] || page;
  hideMessage();
  if (page === "drafts" || page === "dashboard") refreshDrafts();
  if (page === "analytics") refreshAnalytics();
}
document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
document.querySelectorAll("[data-page]").forEach((button) => {
  if (!button.classList.contains("nav-link")) button.addEventListener("click", () => showPage(button.dataset.page));
});
$("new-draft-top").addEventListener("click", () => newDraft());

async function api(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error("Server ने अनपेक्षित response दिया।"); }
  if (response.status === 401) {
    $("identity-status").textContent = "Access login आवश्यक";
    throw new Error("लॉगिन सत्यापित नहीं हुआ। Access login पूरा करें और फिर पुनः प्रयास करें।");
  }
  if (response.status === 403) throw new Error("इस खाते को Admin Portal की अनुमति नहीं है।");
  if (!response.ok) throw new Error(data.error || `Request असफल (HTTP ${response.status})`);
  return data;
}
function renderCapabilities(capabilities = {}) {
  const metadataReady = capabilities.metadata !== false;
  const imageMode = capabilities.imageStorage || "inline-draft-only";
  state.metadataReady = metadataReady;
  $("featured-image-storage-note").textContent = imageMode === "r2"
    ? "इमेज सुरक्षित media storage में रखी जाती है।"
    : "R2 enable नहीं है: image अभी draft के अंदर सीमित आकार में सेव होती है; यह स्थायी media library नहीं है।";
  $("save-button").disabled = !metadataReady;
  $("review-button").disabled = !metadataReady;
  if (!metadataReady) {
    $("metadata-warning").classList.remove("hidden");
    $("metadata-warning").textContent = "Admin D1 में editor metadata migration लागू नहीं है। अभी SEO/Category/Tags या featured image वाले Draft को सेव न करें; backend सुरक्षित रूप से रोक देगा।";
  } else {
    $("metadata-warning").classList.add("hidden");
    $("metadata-warning").textContent = "";
  }
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("hi-IN", { dateStyle: "medium", timeStyle: "short" });
}
function renderDraftRow(draft) {
  const article = document.createElement("article");
  article.className = "draft-item";
  const main = document.createElement("div");
  main.className = "draft-main";
  const title = document.createElement("strong");
  title.textContent = draft.title || "(बिना शीर्षक)";
  const meta = document.createElement("div");
  meta.className = "draft-meta";
  const slug = document.createElement("span");
  slug.textContent = `/${draft.slug || "no-slug"}`;
  const updated = document.createElement("span");
  updated.textContent = `अपडेट: ${dateLabel(draft.updated_at)}`;
  meta.append(slug, updated);
  main.append(title, meta);
  const badge = document.createElement("span");
  badge.className = "draft-status";
  badge.textContent = draft.status === "ready_for_review" ? "Review के लिए" : "Draft";
  const actions = document.createElement("div");
  actions.className = "draft-actions";
  const edit = document.createElement("button");
  edit.className = "button secondary";
  edit.type = "button";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => editDraft(draft.id));
  const remove = document.createElement("button");
  remove.className = "button danger";
  remove.type = "button";
  remove.textContent = "हटाएँ";
  remove.setAttribute("aria-label", "Draft हटाएँ: " + (draft.title || draft.slug));
  remove.addEventListener("click", () => deleteDraft(draft));
  actions.append(edit, remove);
  article.append(main, badge, actions);
  return article;
}
async function deleteDraft(draft) {
  if (!window.confirm("क्या “" + (draft.title || draft.slug) + "” Draft स्थायी रूप से हटाना है?")) return;
  try {
    await api("/api/drafts/" + encodeURIComponent(draft.id), { method: "DELETE" });
    state.drafts = state.drafts.filter((item) => item.id !== draft.id);
    if (state.currentId === draft.id) newDraft();
    renderDrafts();
    showMessage("Draft हटा दिया गया।", "success");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Draft हटाया नहीं जा सका।");
  }
}
function emptyState(title, description) {
  const node = document.createElement("div");
  node.className = "empty";
  const strong = document.createElement("strong"); strong.textContent = title;
  const p = document.createElement("p"); p.textContent = description;
  node.append(strong, p);
  return node;
}
function renderDrafts() {
  const query = $("draft-search").value.trim().toLowerCase();
  const drafts = state.drafts.filter((draft) => `${draft.title} ${draft.slug}`.toLowerCase().includes(query));
  $("draft-count").textContent = String(state.drafts.length);
  $("stat-drafts").textContent = String(state.drafts.length);
  $("stat-saved").textContent = state.drafts[0] ? dateLabel(state.drafts[0].updated_at) : "—";
  const recent = $("recent-drafts"); recent.replaceChildren();
  const recentItems = state.drafts.slice(0, 5);
  if (!recentItems.length) recent.append(emptyState("अभी कोई Draft नहीं है", "“नया Draft” दबाकर अपना पहला लेख बनाएँ।"));
  else recentItems.forEach((draft) => recent.append(renderDraftRow(draft)));
  const all = $("all-drafts"); all.replaceChildren();
  if (!drafts.length) all.append(emptyState(query ? "कोई मिलान नहीं मिला" : "अभी कोई Draft नहीं है", query ? "दूसरा शब्द खोजें।" : "नया Draft बनाकर शुरुआत करें।"));
  else drafts.forEach((draft) => all.append(renderDraftRow(draft)));
}
async function refreshDrafts() {
  try {
    const data = await api("/api/drafts");
    if (!Array.isArray(data.drafts)) throw new Error("Draft API का response सही नहीं है।");
    state.drafts = data.drafts;
    renderCapabilities(data.capabilities);
    $("identity-status").textContent = ADMIN_EMAIL;
    renderDrafts();
  } catch (error) {
    $("identity-status").textContent = "Access verification आवश्यक";
    const message = error instanceof Error ? error.message : "Drafts लोड नहीं हो सके।";
    showMessage(message);
    renderCapabilities({metadata:false});
    if (!state.drafts.length) {
      $("recent-drafts").replaceChildren(emptyState("Drafts लोड नहीं हुए", "Access और Admin API की configuration जाँचें।"));
      $("all-drafts").replaceChildren(emptyState("Drafts उपलब्ध नहीं", "लॉगिन और backend उपलब्ध होने पर फिर प्रयास करें।"));
    }
  }
}
$("draft-search").addEventListener("input", renderDrafts);

function setForm(draft = {}) {
  $("draft-id").value = draft.id || "";
  $("draft-title").value = draft.title || "";
  $("draft-slug").value = draft.slug || "";
  $("draft-summary").value = draft.summary || "";
  $("draft-body").value = draft.body_html || "";
  $("block-editor").innerHTML = sanitizeRichHtml(draft.body_html || "<p><br></p>");
  $("draft-seo-title").value = draft.seo_title || "";
  $("draft-seo-description").value = draft.seo_description || "";
  $("draft-category").value = draft.category || "Happy Life";
  $("draft-tags").value = Array.isArray(draft.tags) ? draft.tags.join(", ") : (draft.tags || "");
  $("draft-featured-image-data").value = draft.featured_image || "";
  $("draft-featured-alt").value = draft.featured_image_alt || "";
  $("featured-image-status").textContent = draft.featured_image ? "Featured image saved in draft." : "कोई featured image नहीं चुनी गई।";
  $("body-length").textContent = `${$("block-editor").innerText.length.toLocaleString()} characters`;
  $("seo-description-count").textContent = String($("draft-seo-description").value.length);
  $("editor-heading").textContent = draft.id ? "Draft संपादित करें" : "नया लेख";
  $("save-button").textContent = draft.id ? "परिवर्तन सेव करें" : "Draft सेव करें";
  $("preview-panel").classList.add("hidden");
  setSaveState(draft.id ? `Last saved: ${dateLabel(draft.updated_at)}` : "अभी सेव नहीं हुआ", draft.id ? "saved" : "");
  state.currentId = draft.id || null;
  state.dirty = false;
  state.lastSaved = draft.updated_at || null;
}
function newDraft() { clearTimeout(state.timer); setForm(); showPage("editor"); }
async function editDraft(id) {
  try {
    const data = await api(`/api/drafts/${encodeURIComponent(id)}`);
    if (!data.draft) throw new Error("Draft नहीं मिला।");
    setForm(data.draft);
    showPage("editor");
  } catch (error) { showMessage(error.message || "Draft खोल नहीं पाए।"); }
}

function formData() {
  return {
    title: $("draft-title").value,
    slug: $("draft-slug").value,
    summary: $("draft-summary").value,
    body_html: $("draft-body").value,
    seo_title: $("draft-seo-title").value,
    seo_description: $("draft-seo-description").value,
    category: $("draft-category").value,
    tags: $("draft-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
    featured_image: $("draft-featured-image-data").value,
    featured_image_alt: $("draft-featured-alt").value,
  };
}
function markDirty() {
  state.dirty = true;
  $("draft-body").value = $("block-editor").innerHTML;
  $("body-length").textContent = `${$("block-editor").innerText.length.toLocaleString()} characters`;
  setSaveState("Unsaved changes…", "saving");
  clearTimeout(state.timer);
  // Auto-save only after title and a valid slug are present to prevent empty records.
  if ($("draft-title").value.trim() && $("draft-slug").value.trim()) {
    state.timer = setTimeout(() => saveDraft({ automatic: true }), 1200);
  }
}
["draft-title", "draft-slug", "draft-summary", "draft-seo-title", "draft-seo-description", "draft-category", "draft-tags", "draft-featured-image-data", "draft-featured-alt"].forEach((id) => $(id).addEventListener("input", markDirty));
$("block-editor").addEventListener("input", () => {
  const safe = sanitizeRichHtml($("block-editor").innerHTML);
  if ($("block-editor").innerHTML !== safe) $("block-editor").innerHTML = safe;
  $("draft-body").value = safe;
  markDirty();
});
document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => {
  $("block-editor").focus();
  const command = button.dataset.command;
  const value = button.dataset.value || null;
  if (command === "formatBlock") document.execCommand(command, false, value);
  else document.execCommand(command, false, value);
  $("draft-body").value = $("block-editor").innerHTML;
  markDirty();
}));
$("review-button").addEventListener("click", async () => {
  if (!state.currentId) {
    showMessage("पहले Draft सेव करें, फिर Review के लिए भेजें।");
    return;
  }
  if (state.dirty || state.saving) {
    showMessage("पहले सभी बदलाव सेव होने दें।");
    return;
  }
  const confirmed = window.confirm("यह Draft review के लिए चिह्नित होगा। इससे वेबसाइट पर publish नहीं होगा। जारी रखें?");
  if (!confirmed) return;
  $("review-button").disabled = true;
  try {
    const result = await api(`/api/drafts/${encodeURIComponent(state.currentId)}/review`, { method: "PATCH" });
    $("review-status").textContent = result.message || "Review के लिए भेज दिया गया।";
    showMessage("Draft review state में है; कुछ भी public नहीं हुआ।", "success");
    await editDraft(state.currentId);
  } catch (error) {
    $("review-button").disabled = false;
    showMessage(error instanceof Error ? error.message : "Review state अपडेट नहीं हुई।");
  }
});
function insertHtmlAtCaret(html) {
  $("block-editor").focus();
  document.execCommand("insertHTML", false, html);
  $("draft-body").value = $("block-editor").innerHTML;
  markDirty();
}
function syncEditorFromBody() {
  $("block-editor").innerHTML = sanitizeRichHtml($("draft-body").value || "<p><br></p>");
  $("body-length").textContent = `${$("block-editor").innerText.length.toLocaleString()} characters`;
}
function addEditorCommand(label, command, value = null) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button secondary";
  button.textContent = label;
  button.addEventListener("click", () => {
    $("block-editor").focus();
    document.execCommand(command, false, value);
    $("draft-body").value = sanitizeRichHtml($("block-editor").innerHTML);
    $("block-editor").innerHTML = $("draft-body").value;
    markDirty();
  });
  $("block-toolbar-extra").append(button);
}
function initializeExtraEditorBlocks() {
  addEditorCommand("Numbered list", "insertOrderedList");
  addEditorCommand("Italic", "italic");
  addEditorCommand("Underline", "underline");
  addEditorCommand("Code", "formatBlock", "pre");
  const undo = document.createElement("button");
  undo.type = "button"; undo.className = "button secondary"; undo.textContent = "Undo";
  undo.addEventListener("click", () => { $("block-editor").focus(); document.execCommand("undo"); $("draft-body").value=sanitizeRichHtml($("block-editor").innerHTML); markDirty(); });
  const redo = document.createElement("button");
  redo.type = "button"; redo.className = "button secondary"; redo.textContent = "Redo";
  redo.addEventListener("click", () => { $("block-editor").focus(); document.execCommand("redo"); $("draft-body").value=sanitizeRichHtml($("block-editor").innerHTML); markDirty(); });
  $("block-toolbar-extra").append(undo, redo);
  $("draft-body").addEventListener("input", syncEditorFromBody);
}
initializeExtraEditorBlocks();
async function imageAsDataUrl(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("कृपया JPEG, PNG या WebP इमेज चुनें।");
  if (file.size > 12 * 1024 * 1024) throw new Error("मूल इमेज 12 MB से छोटी होनी चाहिए।");
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    const scale = Math.min(1, 1200 / img.width, 1200 / img.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image processing उपलब्ध नहीं है।");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 260000 && quality > 0.35) {
      quality -= 0.1;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    if (data.length > 260000) throw new Error("इमेज compress नहीं हो सकी; छोटी image चुनें।");
    return data;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
$("insert-link-button").addEventListener("click", () => {
  const label = window.prompt("लिंक या Button पर दिखने वाला टेक्स्ट लिखें:");
  if (!label || !label.trim()) return;
  const entered = window.prompt("पूरा HTTPS URL दर्ज करें:");
  if (!entered) return;
  let url;
  try { url = new URL(entered.trim()); } catch { showMessage("कृपया सही HTTPS URL दर्ज करें।"); return; }
  if (url.protocol !== "https:") { showMessage("सुरक्षा के लिए केवल HTTPS लिंक स्वीकार हैं।"); return; }
  const isButton = window.confirm("क्या इसे Button की तरह दिखाना है? OK = Button, Cancel = सामान्य लिंक");
  const safeLabel = escapeHtml(label.trim().slice(0, 120));
  const safeUrl = escapeHtml(url.href);
  insertHtmlAtCaret(`<a href="${safeUrl}"${isButton ? ' class="article-button"' : ""} target="_blank" rel="noopener noreferrer">${safeLabel}</a>`);
  showMessage(isButton ? "Button block जोड़ दिया गया।" : "लिंक जोड़ दिया गया।", "success");
});
$("insert-image-button").addEventListener("click", () => $("draft-inline-image").click());
$("draft-inline-image").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    showMessage("इमेज compress हो रही है…", "success");
    const data = await imageAsDataUrl(file);
    const alt = escapeHtml(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
    insertHtmlAtCaret(`<figure><img src="${data}" alt="${alt}" loading="lazy"><figcaption>${alt}</figcaption></figure><p><br></p>`);
    showMessage("इमेज लेख में जोड़ दी गई है; draft सेव करें।", "success");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Image जोड़ने में समस्या हुई।");
  } finally {
    event.target.value = "";
  }
});
$("draft-featured-image").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = await imageAsDataUrl(file);
    $("draft-featured-image-data").value = data;
    $("featured-image-status").textContent = `Featured image तैयार · ${Math.round(data.length / 1024)} KB encoded`;
    if (!$("draft-featured-alt").value.trim()) $("draft-featured-alt").value = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    markDirty();
    showMessage("Featured image draft में जोड़ी गई है; वर्तमान में यह permanent R2 media storage नहीं है।", "success");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Featured image जोड़ नहीं पाए।");
  } finally {
    event.target.value = "";
  }
});

async function saveDraft({ automatic = false } = {}) {
  if (state.metadataReady === false) {
    if (!automatic) showMessage("Admin D1 metadata migration अधूरी है; इस समय Draft save नहीं किया गया।", "error");
    setSaveState("Metadata migration आवश्यक", "error");
    return;
  }
  if (state.saving) { state.dirty = true; return; }
  const data = formData();
  if (!data.title.trim() || !data.slug.trim()) {
    if (!automatic) showMessage("पहले लेख का शीर्षक और URL slug भरें।");
    setSaveState("शीर्षक और slug जरूरी हैं", "error");
    return;
  }
  state.saving = true;
  state.dirty = false;
  $("save-button").disabled = true;
  setSaveState(automatic ? "Auto-saving…" : "सेव हो रहा है…", "saving");
  try {
    let result;
    if (state.currentId) {
      result = await api(`/api/drafts/${encodeURIComponent(state.currentId)}`, { method: "PUT", body: JSON.stringify(data) });
    } else {
      result = await api("/api/drafts", { method: "POST", body: JSON.stringify(data) });
      state.currentId = result.id;
      $("draft-id").value = result.id;
      $("editor-heading").textContent = "Draft संपादित करें";
      $("save-button").textContent = "परिवर्तन सेव करें";
    }
    state.lastSaved = result.updated_at || result.created_at || new Date().toISOString();
    setSaveState(`Saved · ${dateLabel(state.lastSaved)}`, "saved");
    hideMessage();
    await refreshDrafts();
  } catch (error) {
    state.dirty = true;
    setSaveState("सेव नहीं हुआ", "error");
    showMessage(error instanceof Error ? error.message : "Draft सेव नहीं हुआ।");
  } finally {
    state.saving = false;
    $("save-button").disabled = false;
    // If the user typed during the pending request, save the newer version too.
    if (state.dirty && $("draft-title").value.trim() && $("draft-slug").value.trim()) {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => saveDraft({ automatic: true }), 1200);
    }
  }
}
$("draft-form").addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(state.timer); saveDraft(); });

function buildPreviewDocument() {
  const title = $("draft-title").value || "Article preview";
  const content = $("draft-body").value || "<p>No content yet.</p>";
  const csp = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src data:; form-action 'none'; base-uri 'none'";
  // The iframe is sandboxed without allow-same-origin; untrusted code cannot access the admin DOM or origin.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.65 system-ui,sans-serif;padding:1rem;max-width:820px;margin:auto;color:#25392b;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#176b40}.article-button{display:inline-block;background:#176b40;color:#fff;padding:.7rem 1rem;border-radius:.6rem;text-decoration:none;font-weight:700;margin:.4rem 0}</style></head><body><h1>${escapeHtml(title)}</h1>${content}</body></html>`;
}
$("preview-button").addEventListener("click", () => {
  $("preview-frame").srcdoc = buildPreviewDocument();
  $("preview-panel").classList.remove("hidden");
  $("preview-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("close-preview").addEventListener("click", () => {
  $("preview-frame").srcdoc = "";
  $("preview-panel").classList.add("hidden");
});

window.addEventListener("beforeunload", (event) => {
  if (state.dirty || state.saving) {
    event.preventDefault();
    event.returnValue = "";
  }
});


function metricNumber(value) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function metricBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return (n / Math.pow(1024, i)).toLocaleString("en-IN", { maximumFractionDigits: 1 }) + " " + units[i];
}
function renderAnalyticsRows(id, rows, getTitle, getDetail) {
  const list = $(id);
  list.replaceChildren();
  if (!rows.length) {
    list.append(emptyState("इस अवधि में कोई डेटा नहीं", "Cloudflare ने इस समयावधि के लिए कोई matching traffic record नहीं दिया।"));
    return;
  }
  rows.forEach((row) => {
    const item = document.createElement("article");
    item.className = "analytics-row";
    const title = document.createElement("strong");
    title.textContent = getTitle(row);
    const detail = document.createElement("span");
    detail.textContent = getDetail(row);
    item.append(title, detail);
    list.append(item);
  });
}
async function refreshAnalytics() {
  if (state.analyticsLoading) return;
  state.analyticsLoading = true;
  const button = $("analytics-refresh");
  const status = $("analytics-status");
  const error = $("analytics-error");
  const results = $("analytics-results");
  const empty = $("analytics-empty");
  button.disabled = true;
  button.textContent = "लोड हो रहा है…";
  status.textContent = "Cloudflare से डेटा माँगा जा रहा है";
  error.classList.add("hidden");
  results.classList.add("hidden");
  empty.classList.remove("hidden");
  try {
    const days = $("analytics-days").value;
    const data = await api("/api/analytics?days=" + encodeURIComponent(days));
    if (!data || !data.metrics || !Array.isArray(data.topPaths) || !Array.isArray(data.trend)) {
      throw new Error("Analytics API का response मान्य नहीं है।");
    }
    $("analytics-requests").textContent = metricNumber(data.metrics.requests);
    $("analytics-visits").textContent = metricNumber(data.metrics.visits);
    $("analytics-bytes").textContent = metricBytes(data.metrics.dataTransferBytes);
    $("analytics-attribution").textContent = "Source: " + data.source + " · Host: " + data.host + " · " +
      new Date(data.period.start).toLocaleString("hi-IN") + " से " +
      new Date(data.period.end).toLocaleString("hi-IN") +
      ". Requests और visits Cloudflare के zone HTTP metrics हैं; ये unique visitors या page-view counter नहीं हैं।";
    renderAnalyticsRows("analytics-top-paths", data.topPaths,
      (row) => row.path,
      (row) => metricNumber(row.requests) + " requests · " + metricNumber(row.visits) + " visits · " + metricBytes(row.dataTransferBytes));
    renderAnalyticsRows("analytics-daily", data.trend,
      (row) => row.date,
      (row) => metricNumber(row.requests) + " requests · " + metricNumber(row.visits) + " visits");
    results.classList.remove("hidden");
    empty.classList.add("hidden");
    status.textContent = "वास्तविक डेटा · " + days + " दिन";
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analytics लोड नहीं हो सका।";
    error.textContent = message;
    error.classList.remove("hidden");
    status.textContent = "डेटा उपलब्ध नहीं";
    empty.querySelector("strong").textContent = "Analytics अभी उपलब्ध नहीं हैं";
    empty.querySelector("p").textContent = message;
  } finally {
    button.disabled = false;
    button.textContent = "डेटा फिर लोड करें";
    state.analyticsLoading = false;
  }
}
$("analytics-refresh").addEventListener("click", refreshAnalytics);
$("analytics-days").addEventListener("change", refreshAnalytics);

// Read from the protected API at startup. There are no demo rows or guessed metrics.
refreshDrafts();
