import { Modal, Notice, getLanguage, normalizePath, setIcon } from "obsidian";
import { updateText } from "./update-notes-i18n.js";
const queueKey = /* @__PURE__ */ Symbol.for("qiaomu.update-notes.queue.v1");
function compareVersions(a, b) {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}
function readPreferences(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return { seenVersion: typeof value.seenVersion === "string" && /^\d+\.\d+\.\d+$/.test(value.seenVersion) ? value.seenVersion : "", autoShow: value.autoShow !== false };
}
function unseenEntries(entries, seen, current) {
  return entries.filter((entry) => compareVersions(entry.version, current) <= 0 && (!seen || compareVersions(entry.version, seen) > 0)).sort((a, b) => compareVersions(b.version, a.version));
}
function queueFor(app) {
  const owner = app;
  if (owner[queueKey]) return owner[queueKey];
  const queue = { jobs: [], active: null, timer: null, pump: () => {
  } };
  queue.pump = () => {
    if (!queue.jobs.length) {
      if (queue.timer !== null) window.clearInterval(queue.timer);
      queue.timer = null;
      return;
    }
    if (queue.active) return;
    const index = document.querySelector(".modal-container") ? queue.jobs.findIndex(job => job.manual) : 0;
    if (index < 0) return;
    const job = queue.jobs.splice(index, 1)[0];
    if (job) {
      queue.active = job.id;
      job.run();
    }
  };
  owner[queueKey] = queue;
  return queue;
}
class UpdateNotes {
  constructor(plugin, entries, language = getLanguage) {
    this.plugin = plugin;
    this.entries = entries;
    this.language = language;
    this.path = normalizePath(`${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/update-notes.json`);
    this.ready = this.load();
    plugin.addCommand({ id: "view-update-notes", name: this.text("view"), callback: () => this.show() });
    plugin.register(() => this.dispose());
    plugin.app.workspace.onLayoutReady(() => {
      void this.ready.then(() => {
        if (!this.disposed && this.preferences.autoShow && compareVersions(plugin.manifest.version, this.preferences.seenVersion) > 0) this.enqueue(true);
      });
    });
  }
  plugin;
  entries;
  language;
  preferences = readPreferences(null);
  path;
  ready;
  writeQueue = Promise.resolve();
  disposed = false;
  writable = true;
  modal = null;
  pendingAutomatic = false;
  text(key) {
    return updateText(this.language(), key);
  }
  addButton(parent) {
    const button = parent.createEl("button", { text: this.text("view"), cls: "qiaomu-update-notes-link", attr: { type: "button" } });
    const icon = button.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(icon, "history");
    button.prepend(icon);
    button.addEventListener("click", () => this.show());
  }
  show() {
    void this.ready.then(() => {
      if (!this.disposed) this.enqueue(false);
    });
  }
  async load() {
    const adapter = this.plugin.app.vault.adapter;
    try {
      if (await adapter.exists(this.path)) this.preferences = readPreferences(JSON.parse(await adapter.read(this.path)));
    } catch {
      this.writable = false;
      this.preferences = { seenVersion: this.plugin.manifest.version, autoShow: false };
    }
  }
  save(patch) {
    const task = this.writeQueue.catch(() => {
    }).then(async () => {
      if (this.disposed) return;
      if (!this.writable) throw new Error("Update metadata is unreadable");
      const next = { ...this.preferences, ...patch };
      await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(next));
      this.preferences = next;
    });
    this.writeQueue = task;
    return task;
  }
  enqueue(automatic) {
    if (this.modal || this.disposed) return;
    const queue = queueFor(this.plugin.app), id = this.plugin.manifest.id;
    const existing = queue.jobs.find((job) => job.id === id);
    if (existing) {
      if (!automatic) { this.pendingAutomatic = false; existing.manual = true; }
      return;
    }
    this.pendingAutomatic = automatic;
    queue.jobs.push({ id, manual: !automatic, run: () => this.open(queue) });
    if (queue.timer === null) queue.timer = window.setInterval(() => queue.pump(), 300);
  }
  open(queue) {
    if (this.disposed) {
      queue.active = null;
      queue.pump();
      return;
    }
    const current = this.plugin.manifest.version;
    const entries = unseenEntries(this.entries, this.pendingAutomatic ? this.preferences.seenVersion : "", current);
    this.modal = new NotesModal(
      this.plugin.app,
      this.plugin.manifest.name,
      current,
      entries,
      (key) => this.text(key),
      this.preferences.autoShow,
      async (enabled) => {
        await this.save({ autoShow: enabled });
      },
      () => {
        this.modal = null;
        queue.active = null;
      }
    );
    this.modal.open();
    const seenVersion = compareVersions(current, this.preferences.seenVersion) > 0 ? current : this.preferences.seenVersion;
    void this.save({ seenVersion }).catch(() => {
      if (!this.disposed) new Notice(this.text("saveError"));
    });
  }
  dispose() {
    this.disposed = true;
    const queue = queueFor(this.plugin.app);
    queue.jobs = queue.jobs.filter((job) => job.id !== this.plugin.manifest.id);
    this.modal?.close();
    queue.pump();
  }
}
class NotesModal extends Modal {
  constructor(app, name, version, entries, text, enabled, change, finished) {
    super(app);
    this.name = name;
    this.version = version;
    this.entries = entries;
    this.text = text;
    this.enabled = enabled;
    this.change = change;
    this.finished = finished;
  }
  name;
  version;
  entries;
  text;
  enabled;
  change;
  finished;
  onOpen() {
    this.modalEl.addClass("qiaomu-update-notes");
    this.modalEl.dir = this.text("done") === "\u062D\u0633\u0646\u064B\u0627" ? "rtl" : "ltr";
    this.setTitle(`${this.name} \xB7 ${this.text("title")}`);
    const content = this.contentEl;
    content.createEl("p", { text: `v${this.version}`, cls: "qiaomu-update-notes-version" });
    const entries = this.entries.length ? this.entries : [{ version: this.version, items: ["fallback"] }];
    for (const entry of entries) {
      const section = content.createEl("section", { cls: "qiaomu-update-notes-section" });
      if (entries.length > 1) section.createEl("h3", { text: `v${entry.version}` });
      const list = section.createEl("ul");
      for (const item of entry.items) list.createEl("li", { text: this.text(item) });
    }
    const footer = content.createDiv({ cls: "qiaomu-update-notes-footer" });
    const label = footer.createEl("label", { cls: "qiaomu-update-notes-option" });
    const input = label.createEl("input", { attr: { type: "checkbox" } });
    input.checked = this.enabled;
    label.createSpan({ text: this.text("automatic") });
    input.addEventListener("change", () => {
      const desired = input.checked;
      input.disabled = true;
      void this.change(desired).then(() => {
        this.enabled = desired;
      }).catch(() => {
        input.checked = this.enabled;
        new Notice(this.text("saveError"));
      }).finally(() => {
        input.disabled = false;
      });
    });
    const close = footer.createEl("button", { text: this.text("done"), cls: "qiaomu-update-notes-done", attr: { type: "button" } });
    close.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
    this.finished();
  }
}
export {
  UpdateNotes,
  compareVersions,
  readPreferences,
  unseenEntries
};
