const API_BASE = ""; // Same protected hostname; /api/* must be routed to the separate Admin API Worker.
const ADMIN_EMAIL = "shashank77a@gmail.com";
const $ = (id) => document.getElementById(id);
const state = { drafts: [], currentId: null, timer: null, saving: false, dirty: false, lastSaved: null };
const pageNames = { dashboard: "Dashboard", drafts: "Drafts", editor: "लेख Editor", analytics: "Analytics" };

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
  const edit = document.createElement("button");
  edit.className = "button secondary";
  edit.type = "button";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => editDraft(draft.id));
  article.append(main, badge, edit);
  return article;
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
    $("identity-status").textContent = ADMIN_EMAIL;
    renderDrafts();
  } catch (error) {
    $("identity-status").textContent = "Access verification आवश्यक";
    const message = error instanceof Error ? error.message : "Drafts लोड नहीं हो सके।";
    showMessage(message);
    if (!state.drafts.length) {
      $("recent-drafts").replaceChildren(emptyState("Drafts लोड नहीं हुए", "Access और Admin API की configuration जाँचें।"));
      $("all-drafts").replaceChildren(emptyState("Drafts उपलब्ध नहीं", "लॉगिन और backend उपलब्ध होने पर फिर प्रयास करें।"));
    }
  }
}
$("draft-search").addEventListener("input", renderDrafts);

function safeTags(value) {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : []; }
  catch { return []; }
}
function setForm(draft = {}) {
  $("draft-id").value = draft.id || "";
  $("draft-title").value = draft.title || "";
  $("draft-slug").value = draft.slug || "";
  $("draft-summary").value = draft.summary || "";
  $("draft-seo-title").value = draft.seo_title || "";
  $("draft-seo-description").value = draft.seo_description || "";
  $("draft-category").value = draft.category || "";
  $("draft-tags").value = Array.isArray(draft.tags) ? draft.tags.join(", ") : (draft.tags_json ? safeTags(draft.tags_json).join(", ") : "");
  $("draft-featured-image").value = draft.featured_image_url || "";
  $("draft-featured-alt").value = draft.featured_image_alt || "";
  $("draft-canonical").value = draft.canonical_url || "";
  $("draft-body").value = draft.body_html || "";
  $("body-length").textContent = `${$("draft-body").value.length.toLocaleString()} characters`;
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
    tags: $("draft-tags").value.split(",").map(tag => tag.trim()).filter(Boolean).slice(0, 30),
    featured_image_url: $("draft-featured-image").value,
    featured_image_alt: $("draft-featured-alt").value,
    canonical_url: $("draft-canonical").value,
  };
}
function markDirty() {
  state.dirty = true;
  $("body-length").textContent = `${$("draft-body").value.length.toLocaleString()} characters`;
  setSaveState("Unsaved changes…", "saving");
  clearTimeout(state.timer);
  // Auto-save only after title and a valid slug are present to prevent empty records.
  if ($("draft-title").value.trim() && $("draft-slug").value.trim()) {
    state.timer = setTimeout(() => saveDraft({ automatic: true }), 1200);
  }
}
["draft-title", "draft-slug", "draft-summary", "draft-seo-title", "draft-seo-description", "draft-category", "draft-tags", "draft-featured-image", "draft-featured-alt", "draft-canonical", "draft-body"].forEach((id) => $(id).addEventListener("input", markDirty));

async function saveDraft({ automatic = false } = {}) {
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
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.65 system-ui,sans-serif;padding:1rem;max-width:820px;margin:auto;color:#25392b;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#176b40}</style></head><body><h1>${escapeHtml(title)}</h1>${content}</body></html>`;
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

const blockTemplates = {
  h2: "<h2>नया शीर्षक</h2>\n",
  p: "<p>यहाँ अपना पैराग्राफ लिखें।</p>\n",
  ul: "<ul>\n  <li>पहला बिंदु</li>\n  <li>दूसरा बिंदु</li>\n</ul>\n",
  ol: "<ol>\n  <li>पहला चरण</li>\n  <li>दूसरा चरण</li>\n</ol>\n",
  blockquote: "<blockquote><p>यहाँ महत्वपूर्ण विचार लिखें।</p></blockquote>\n",
  hr: "<hr>\n",
};
document.querySelectorAll("[data-insert]").forEach(button => button.addEventListener("click", () => {
  const area = $("draft-body");
  const snippet = blockTemplates[button.dataset.insert];
  if (!snippet) return;
  const start = area.selectionStart ?? area.value.length;
  const end = area.selectionEnd ?? start;
  area.setRangeText(snippet, start, end, "select");
  area.focus();
  markDirty();
}));
$("pick-image").addEventListener("click", () => $("image-file").click());
$("image-file").addEventListener("change", async () => {
  const file = $("image-file").files?.[0];
  if (!file) return;
  const status = $("image-upload-state");
  if (file.size > 5 * 1024 * 1024) { status.textContent = "चित्र 5 MB से छोटा होना चाहिए।"; return; }
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) { status.textContent = "JPEG, PNG, WebP, GIF या AVIF चित्र चुनें।"; return; }
  status.textContent = "चित्र अपलोड हो रहा है…";
  try {
    const response = await fetch("/api/media", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": file.type, "x-image-content-type": file.type },
      body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Image upload असफल हुआ।");
    if (!data.url) throw new Error("Public image URL नहीं मिला।");
    $("draft-featured-image").value = data.url;
    const alt = $("draft-featured-alt").value || file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    $("draft-featured-alt").value = alt;
    const area = $("draft-body");
    const pos = area.selectionStart ?? area.value.length;
    const imageHtml = '<figure><img src="' + escapeHtml(data.url) + '" alt="' + escapeHtml(alt) + '" loading="lazy"><figcaption>चित्र का कैप्शन यहाँ लिखें</figcaption></figure>\n';
    area.setRangeText(imageHtml, pos, area.selectionEnd ?? pos, "end");
    markDirty();
    status.textContent = "चित्र अपलोड हुआ और लेख में जोड़ा गया।";
  } catch (error) {
    status.textContent = error.message || "चित्र अपलोड नहीं हुआ।";
  } finally {
    $("image-file").value = "";
  }
});
document.querySelectorAll("[data-preview-width]").forEach(button => button.addEventListener("click", () => {
  $("preview-frame").classList.toggle("mobile-preview", button.dataset.previewWidth === "mobile");
  $("preview-frame").classList.toggle("desktop-preview", button.dataset.previewWidth === "desktop");
}));
$("review-button").addEventListener("click", async () => {
  if (state.dirty) await saveDraft();
  if (!state.currentId) { showMessage("पहले Draft को सफलतापूर्वक सेव करें।"); return; }
  if (state.dirty || state.saving) { showMessage("सेव पूरा होने के बाद Review भेजें।"); return; }
  try {
    await api("/api/drafts/" + encodeURIComponent(state.currentId) + "/review", { method: "POST" });
    setSaveState("Review queue में भेजा गया", "saved");
    showMessage("Draft Review queue में भेज दिया गया। अभी सार्वजनिक वेबसाइट पर प्रकाशित नहीं हुआ।", "success");
    await refreshDrafts();
  } catch (error) { showMessage(error.message || "Review request असफल हुई।"); }
});


// Read from the protected API at startup. There are no demo rows or guessed metrics.
refreshDrafts();

