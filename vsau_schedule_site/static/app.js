const state = {
  tree: null,
  files: [],
  selectedFile: null,
  selectedSheet: 0,
  workbook: null,
  query: "",
  weekMode: "current",
  sectionsCollapsed: localStorage.getItem("studentSectionsCollapsed") === "1",
  filters: {
    faculty: "",
    semester: "",
    section: "",
  },
};

const els = {
  tree: document.querySelector("#tree"),
  status: document.querySelector("#status"),
  search: document.querySelector("#searchInput"),
  sectionsToggle: document.querySelector("#sectionsToggle"),
  refresh: document.querySelector("#refreshBtn"),
  empty: document.querySelector("#emptyState"),
  fileView: document.querySelector("#fileView"),
  fileTitle: document.querySelector("#fileTitle"),
  fileMeta: document.querySelector("#fileMeta"),
  openDriveLink: document.querySelector("#openDriveLink"),
  reloadFile: document.querySelector("#reloadFileBtn"),
  weekControls: document.querySelector("#weekControls"),
  tabs: document.querySelector("#sheetTabs"),
  content: document.querySelector("#scheduleContent"),
};

const WEEK_LABELS = {
  current: "Текущая",
  numerator: "Числитель",
  denominator: "Знаменатель",
  all: "Все",
};

const SYSTEM_FILE_NAMES = new Set(["thumbs.db", ".ds_store", "desktop.ini"]);
const EXCEL_EXTENSIONS = new Set(["xlsx", "xlsm", "xltx", "xltm", "xls"]);
const API_BASE = "/students";

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function setStatus(text) {
  els.status.textContent = text;
}

function updateSectionsCollapsed() {
  document.body.classList.toggle("sections-collapsed", state.sectionsCollapsed);
  if (els.sectionsToggle) {
    els.sectionsToggle.textContent = state.sectionsCollapsed ? "Показать разделы" : "Скрыть разделы";
    els.sectionsToggle.setAttribute("aria-expanded", String(!state.sectionsCollapsed));
  }
  localStorage.setItem("studentSectionsCollapsed", state.sectionsCollapsed ? "1" : "0");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function transliterateLatinToCyrillic(value) {
  const map = {
    shch: "щ", yo: "е", zh: "ж", kh: "х", ts: "ц", ch: "ч", sh: "ш", yu: "ю", ya: "я",
    a: "а", b: "б", c: "ц", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "й",
    k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т",
    u: "у", v: "в", w: "в", x: "кс", y: "ы", z: "з",
  };
  return String(value || "").toLowerCase().replace(/shch|yo|zh|kh|ts|ch|sh|yu|ya|[a-z]/g, (part) => map[part] || part);
}

function transliterateCyrillicToLatin(value) {
  const map = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  };
  return String(value || "").toLowerCase().replace(/[а-яё]/g, (part) => map[part] ?? part);
}

function normalizeSearchValue(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[._()[\]{}№#"'`/\\|:;,+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchValue(value) {
  return normalizeSearchValue(value).replace(/[^0-9a-zа-я]+/g, "");
}

function searchForms(value) {
  const forms = new Set();
  const source = String(value || "");
  [source, transliterateLatinToCyrillic(source), transliterateCyrillicToLatin(source)].forEach((variant) => {
    const normalized = normalizeSearchValue(variant);
    const compact = compactSearchValue(variant);
    if (normalized) forms.add(normalized);
    if (compact) forms.add(compact);
  });
  return [...forms];
}

function matchesSearchText(text, query) {
  const source = String(text || "");
  const rawQuery = String(query || "").trim();
  if (!rawQuery) return true;

  const haystackForms = searchForms(source);
  const queryForms = searchForms(rawQuery);
  if (queryForms.some((queryForm) => haystackForms.some((haystackForm) => haystackForm.includes(queryForm)))) {
    return true;
  }

  const tokens = normalizeSearchValue(rawQuery).split(" ").filter(Boolean);
  return tokens.length > 1 && tokens.every((token) =>
    searchForms(token).some((tokenForm) =>
      haystackForms.some((haystackForm) => haystackForm.includes(tokenForm))
    )
  );
}

function flattenFiles(node, trail = []) {
  if (!node) return [];
  if (node.type === "file") {
    return isSystemFile(node) ? [] : [{ ...node, trail }];
  }
  return (node.children || []).flatMap((child) => flattenFiles(child, [...trail, node.title]));
}

function isSystemFile(file) {
  return SYSTEM_FILE_NAMES.has(String(file.title || "").trim().toLowerCase());
}

function fileTypeLabel(file) {
  const ext = String(file.extension || "").trim().toUpperCase();
  if (!ext) return "ФАЙЛ";
  return EXCEL_EXTENSIONS.has(ext.toLowerCase()) ? "" : ext;
}

function fileBadgeMarkup(file) {
  const label = fileTypeLabel(file);
  return label ? ` <span class="file-badge">${escapeHtml(label)}</span>` : "";
}

function readableFileTitle(file) {
  let title = String(file.title || "Файл").trim();
  title = title.replace(/\.[^.]+$/, "");
  title = title.replace(/^(?:ВППА|ППА|ПА|PA)[_\s-]*/i, "");
  title = title.replace(/\bRaspisanie\b/gi, "Расписание");
  title = title.replace(/\bekzamenov\b/gi, "экзаменов");
  title = title.replace(/\bekzameny\b/gi, "экзамены");
  title = title.replace(/\bkurs\b/gi, "курс");
  title = title.replace(/\bYu\b/gi, "Юриспруденция");
  title = title.replace(/\bLeto\b/gi, "лето");
  title = title.replace(/\bZima\b/gi, "зима");
  title = title.replace(/\bMag\b/gi, "магистратура");
  title = title.replace(/_/g, " ");
  title = title.replace(/\b\d{2}\.\d{2}\.\d{2}\b/g, "");
  title = title.replace(/\s*[-–]\s*/g, " - ");
  title = title.replace(/\b(\d{2}\.\d{2}\.\d{2})\b/g, "");
  title = title.replace(/\b(\d{2}\.\d{2}\.\d{1})\b/g, "");
  title = title.replace(/\b(\d{2}\.\d{2})\b/g, "");
  title = title.replace(/\b(\d{2}\.\d{2}\.\d{2,})\b/g, "");
  title = title.replace(/\b(20\d{2})\s*-\s*(20\d{2})\b/g, "$1-$2");
  title = title.replace(/(\d)\s*курс/gi, "$1 курс");
  title = title.replace(/\s+/g, " ").trim();

  title = title
    .replace(/юриспруденции/gi, "Юриспруденция")
    .replace(/юриспруденция/gi, "Юриспруденция")
    .replace(/\bРасписание Экзаменов\b/g, "Расписание экзаменов")
    .replace(/экзамены/gi, "экзамены")
    .replace(/экзаменов/gi, "экзаменов")
    .replace(/лето/gi, "лето")
    .replace(/зима/gi, "зима");

  if (/Расписание экзаменов|экзамены|экзаменов/i.test(title)) {
    const year = title.match(/\b20\d{2}-20\d{2}\b/)?.[0] || "";
    const course = title.match(/\d+\s*курс/i)?.[0]?.replace(/\s+/, " ") || "";
    const season = title.match(/(?:лето|зима)/i)?.[0]?.toLowerCase() || "";
    const program = title.match(/Юриспруденция/i)?.[0] || "";
    const subject = "Расписание экзаменов";
    const parts = [subject, program, course, season, year].filter(Boolean);
    if (parts.length > 1) {
      title = parts.join(" · ");
    }
  }

  return title || String(file.title || "Файл");
}

function matchesSearch(file) {
  if (!state.query) return true;
  const haystack = [file.title, readableFileTitle(file), file.modified, file.extension, ...(file.trail || [])]
    .filter(Boolean)
    .join(" ");
  return matchesSearchText(haystack, state.query);
}

function pathParts(file) {
  const rootTitle = state.tree?.title;
  return (file.trail || []).filter((part) => part && part !== rootTitle);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function filesForFilterStep(step) {
  return state.files.filter((file) => {
    const [faculty, semester] = pathParts(file);
    if (step !== "faculty" && state.filters.faculty && faculty !== state.filters.faculty) return false;
    if (step === "section" && state.filters.semester && semester !== state.filters.semester) return false;
    return true;
  });
}

function optionMarkup(values, placeholder, selected) {
  return `
    <option value="">${escapeHtml(placeholder)}</option>
    ${values
      .map((value) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`)
      .join("")}
  `;
}

function visibleFiles() {
  return state.files.filter((file) => {
    const [faculty, semester, section] = pathParts(file);
    if (state.filters.faculty && faculty !== state.filters.faculty) return false;
    if (state.filters.semester && semester !== state.filters.semester) return false;
    if (state.filters.section && section !== state.filters.section) return false;
    return matchesSearch(file);
  });
}

function renderTree() {
  if (!state.tree) {
    els.tree.innerHTML = "";
    return;
  }
  document.body.classList.toggle("schedule-open", Boolean(state.selectedFile));

  const faculties = unique(filesForFilterStep("faculty").map((file) => pathParts(file)[0]));
  const semesters = unique(filesForFilterStep("semester").map((file) => pathParts(file)[1]));
  const sections = unique(filesForFilterStep("section").map((file) => pathParts(file)[2]));
  const hasActiveFilter = Boolean(
    state.query || state.filters.faculty || state.filters.semester || state.filters.section
  );
  const files = hasActiveFilter ? visibleFiles() : [];
  const countText = hasActiveFilter ? `${files.length} файлов` : "Выберите факультет или начните поиск";

  els.tree.innerHTML = `
    <div class="filters">
      <label class="filter-control">
        <span>Факультет</span>
        <select data-filter="faculty">
          ${optionMarkup(faculties, "Все факультеты", state.filters.faculty)}
        </select>
      </label>
      <label class="filter-control">
        <span>Семестр</span>
        <select data-filter="semester">
          ${optionMarkup(semesters, "Все семестры", state.filters.semester)}
        </select>
      </label>
      <label class="filter-control">
        <span>Раздел</span>
        <select data-filter="section">
          ${optionMarkup(sections, "Все разделы", state.filters.section)}
        </select>
      </label>
      <button class="reset-filters" type="button">Сбросить</button>
    </div>

    <div class="file-count">${escapeHtml(countText)}</div>
    <div class="file-list">
      ${files
        .map((file) => {
          const active = state.selectedFile?.id === file.id ? " active" : "";
          const trail = pathParts(file).join(" / ");
          const readableTitle = readableFileTitle(file);
          return `
            <button class="file-row${active}" data-file-id="${file.id}" type="button">
              <span class="file-name">${escapeHtml(readableTitle)}${fileBadgeMarkup(file)}</span>
              ${readableTitle !== file.title ? `<span class="file-original">${escapeHtml(file.title)}</span>` : ""}
              <span class="file-path">${escapeHtml(trail)}</span>
              <span class="file-date">${escapeHtml(file.modified || "")}</span>
            </button>
          `;
        })
        .join("") || `<div class="notice compact">${hasActiveFilter ? "Ничего не найдено." : "Файлы появятся после выбора раздела."}</div>`}
    </div>
  `;

  els.tree.querySelectorAll("[data-filter]").forEach((select) => {
    select.addEventListener("change", () => {
      const key = select.dataset.filter;
      state.filters[key] = select.value;
      if (key === "faculty") {
        state.filters.semester = "";
        state.filters.section = "";
      }
      if (key === "semester") {
        state.filters.section = "";
      }
      renderTree();
    });
  });

  els.tree.querySelector(".reset-filters")?.addEventListener("click", () => {
    state.filters = { faculty: "", semester: "", section: "" };
    renderTree();
  });

  els.tree.querySelectorAll("[data-file-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const file = state.files.find((item) => item.id === button.dataset.fileId);
      if (file) loadFile(file);
    });
  });
}

async function loadTree(force = false) {
  setStatus(force ? "Обновляю Google Drive..." : "Читаю папки Google Drive...");
  const response = await fetch(apiUrl(`/api/tree${force ? "?refresh=1" : ""}`));
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Не удалось загрузить структуру");

  state.tree = payload.tree;
  state.files = flattenFiles(payload.tree);
  renderTree();
  const count = flattenFiles(payload.tree).length;
  const updated = payload.tree.refreshedAt ? new Date(payload.tree.refreshedAt).toLocaleString("ru-RU") : "только что";
  setStatus(`Файлов: ${count}. Обновлено: ${updated}`);
  openFileFromUrl();
}

function openFileFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fileId = params.get("fileId");
  if (!fileId || state.selectedFile?.id === fileId) return;

  const file = state.files.find((item) => item.id === fileId) || {
    id: fileId,
    title: params.get("title") || "Файл",
    extension: params.get("ext") || "",
    viewUrl: `https://drive.google.com/file/d/${fileId}/view`,
  };
  loadFile(file).catch((error) => {
    els.content.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
  });
}

function fileQuery(file, refresh = false) {
  const params = new URLSearchParams({
    ext: file.extension || "xlsx",
    title: file.title,
  });
  if (refresh) params.set("refresh", "1");
  return apiUrl(`/api/schedule/${file.id}?${params.toString()}`);
}

async function loadFile(file, refresh = false) {
  state.selectedFile = file;
  state.selectedSheet = 0;
  state.workbook = null;
  syncFileUrl(file);
  renderTree();
  els.empty.classList.add("hidden");
  els.fileView.classList.remove("hidden");
  els.fileTitle.textContent = readableFileTitle(file);
  els.fileMeta.textContent = "Загрузка файла из Google Drive...";
  els.openDriveLink.href = file.viewUrl || `https://drive.google.com/file/d/${file.id}/view`;
  els.content.innerHTML = `<div class="notice">${EXCEL_EXTENSIONS.has(String(file.extension || "").toLowerCase()) ? "Парсю таблицу Excel..." : "Готовлю предпросмотр файла..."}</div>`;
  els.tabs.innerHTML = "";
  els.weekControls.classList.add("hidden");
  els.reloadFile.disabled = true;
  els.reloadFile.textContent = refresh ? "Обновляю..." : "Загружаю...";

  try {
    const response = await fetch(fileQuery(file, refresh));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить файл");

    state.workbook = payload;
    els.fileTitle.textContent = readableFileTitle({ ...file, title: payload.title || file.title });

    if (!payload.sheets) {
      renderFilePreview(payload);
      return;
    }

    const hash = payload.sha256 ? payload.sha256.slice(0, 12) : "";
    els.fileMeta.textContent = `Кэш: ${new Date(payload.cachedAt).toLocaleString("ru-RU")} · SHA-256 ${hash}`;
    renderWorkbook();
  } finally {
    els.reloadFile.disabled = false;
    els.reloadFile.textContent = "Обновить файл";
  }
}

function syncFileUrl(file) {
  const params = new URLSearchParams(window.location.search);
  params.set("fileId", file.id);
  params.set("ext", file.extension || "");
  params.set("title", file.title || "Файл");
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function renderFilePreview(payload) {
  els.fileMeta.textContent = [
    payload.extension ? payload.extension.toUpperCase() : "Файл",
    payload.message || "Предпросмотр файла",
  ].filter(Boolean).join(" · ");
  els.weekControls.classList.add("hidden");
  els.tabs.innerHTML = "";

  const title = escapeHtml(readableFileTitle({ ...state.selectedFile, title: payload.title || state.selectedFile?.title || "Файл" }));
  const previewUrl = payload.previewUrl || payload.viewUrl || payload.downloadUrl || "";
  const driveUrl = payload.viewUrl || "";
  const downloadUrl = payload.downloadUrl || previewUrl;

  if (!previewUrl) {
    els.content.innerHTML = `<div class="notice">Для этого файла нет доступного предпросмотра.</div>`;
    return;
  }

  const actions = `
    <div class="preview-actions">
      ${driveUrl ? `<a class="button ghost" href="${escapeHtml(driveUrl)}" target="_blank" rel="noreferrer">Открыть в Drive</a>` : ""}
      ${downloadUrl ? `<a class="button ghost" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noreferrer">Скачать</a>` : ""}
    </div>
  `;

  if (payload.previewKind === "image") {
    els.content.innerHTML = `
      <div class="file-preview">
        <div class="preview-head"><strong>${title}</strong>${actions}</div>
        <div class="image-preview"><img src="${escapeHtml(previewUrl)}" alt="${title}"></div>
      </div>
    `;
    return;
  }

  els.content.innerHTML = `
    <div class="file-preview">
      <div class="preview-head"><strong>${title}</strong>${actions}</div>
      <iframe class="preview-frame" src="${escapeHtml(previewUrl)}" title="${title}"></iframe>
    </div>
  `;
}

function renderWorkbook() {
  const workbook = state.workbook;
  if (!workbook?.sheets?.length) {
    els.content.innerHTML = '<div class="notice">В книге нет заполненных листов.</div>';
    return;
  }

  const sheets = workbook.sheets.filter((sheet) => hasSheetContent(sheet));
  if (!sheets.length) {
    els.tabs.innerHTML = "";
    els.content.innerHTML = '<div class="notice">В книге нет заполненных листов.</div>';
    return;
  }
  if (state.selectedSheet >= sheets.length) state.selectedSheet = 0;

  els.tabs.innerHTML = sheets.length > 1
    ? sheets
    .map((sheet, index) => `
      <button class="tab${index === state.selectedSheet ? " active" : ""}" data-sheet="${index}" type="button">
        ${escapeHtml(sheet.name)}
      </button>
    `)
    .join("")
    : "";

  els.tabs.querySelectorAll("[data-sheet]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSheet = Number(button.dataset.sheet);
      renderWorkbook();
    });
  });

  renderSheet(sheets[state.selectedSheet]);
}

function renderWeekControls() {
  const current = currentWeekInfo();
  els.weekControls.classList.remove("hidden");
  els.weekControls.innerHTML = `
    <div class="week-summary">
      <span>Сейчас: ${current.week === 1 ? "числитель" : "знаменатель"}</span>
      <strong>${escapeHtml(current.range)}</strong>
    </div>
    <div class="week-tabs" role="group" aria-label="Фильтр недели">
      ${Object.entries(WEEK_LABELS).map(([mode, label]) => `
        <button class="week-tab${state.weekMode === mode ? " active" : ""}" data-week-mode="${mode}" type="button">
          ${label}
        </button>
      `).join("")}
    </div>
  `;

  els.weekControls.querySelectorAll("[data-week-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.weekMode = button.dataset.weekMode;
      renderWorkbook();
    });
  });
}

function hasSheetContent(sheet) {
  return (sheet.rows || []).some((row) =>
    row.some((cell) => String(cell.value || "").trim())
  );
}

function styleFor(cell) {
  const style = cell.style || {};
  const rules = [];
  if (style.bold) rules.push("font-weight: 600");
  if (style.italic) rules.push("font-style: italic");
  if (style.fill) rules.push(`background: ${style.fill}`);
  if (style.color) rules.push(`color: ${style.color}`);
  if (style.align) rules.push(`text-align: ${style.align}`);
  if (style.valign) rules.push(`vertical-align: ${style.valign}`);
  return rules.join("; ");
}

function renderSheet(sheet) {
  const query = state.query.trim();
  const rows = trimSheetRows(sheet.rows || []);
  if (!rows.length) {
    els.content.innerHTML = '<div class="notice">Лист пуст.</div>';
    return;
  }

  const title = extractTitle(rows);
  const bodyRows = title ? rows.slice(1) : rows;
  const scheduleModel = buildScheduleModel(title, bodyRows);
  if (scheduleModel.days.length) {
    if (scheduleModel.hasWeekSplit) {
      renderWeekControls();
    } else {
      els.weekControls.classList.add("hidden");
    }
    renderScheduleCards(scheduleModel, query);
    return;
  }

  els.weekControls.classList.add("hidden");

  const htmlRows = bodyRows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const value = cell.value || "";
          const isMatch = query && matchesSearchText(value, query);
          const classes = [
            value ? "has-value" : "",
            isMatch ? "match" : "",
            cell.col <= 2 ? "axis-cell" : "",
            isLessonCell(cell, value) ? "lesson-cell" : "",
            isHeaderCell(cell) ? "header-cell" : "",
          ].filter(Boolean).join(" ");
          const rowSpan = cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : "";
          const colSpan = cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : "";
          return `
            <td class="${classes}" data-col="${cell.col}"${rowSpan}${colSpan} style="${styleFor(cell)}">
              ${escapeHtml(value)}
            </td>
          `;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  els.content.innerHTML = `
    <div class="schedule-view">
      ${title ? `<div class="schedule-title">${escapeHtml(title)}</div>` : ""}
      <div class="schedule-scroll">
        <table class="sheet-table">${htmlRows}</table>
      </div>
    </div>
  `;
}

function buildScheduleModel(title, rows) {
  const dataStart = rows.findIndex((row) =>
    row.some((cell) => cell.col === 2 && /^\d{1,2}:\d{2}/.test(String(cell.value || "")))
  );

  if (dataStart < 1) return { title, days: [] };

  const headerRows = rows.slice(0, dataStart);
  const dataRows = rows.slice(dataStart);
  const maxCol = Math.max(
    0,
    ...rows.flatMap((row) => row.map((cell) => cell.col + (cell.colSpan || 1) - 1))
  );

  const groupsByCol = new Map();
  for (let col = 3; col <= maxCol; col += 1) {
    const labels = headerRows
      .map((row) => row.find((cell) => coversColumn(cell, col))?.value)
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    groupsByCol.set(col, labels.join(" / ") || `Колонка ${col}`);
  }

  const days = [];
  let currentDay = null;
  let currentTime = "";
  let currentTimeRow = 0;

  dataRows.forEach((row) => {
    const dayValue = String(row.find((cell) => cell.col === 1)?.value || "").trim();
    if (dayValue) {
      currentDay = { name: cleanDayName(dayValue), slots: [] };
      days.push(currentDay);
    }
    if (!currentDay) return;

    const timeCell = row.find((cell) => cell.col === 2);
    const time = String(timeCell?.value || "").trim();
    if (time) {
      currentTime = time;
      currentTimeRow = 1;
    } else if (currentTime) {
      currentTimeRow += 1;
    }

    const week = currentTimeRow <= 1 ? 1 : 2;
    const lessonCells = row.filter((cell) => cell.col >= 3 && String(cell.value || "").trim());
    if (!time && !lessonCells.length) return;

    const lessons = lessonCells.map((cell) => ({
      groups: groupsForCell(cell, groupsByCol),
      raw: String(cell.value || "").trim(),
      parts: lessonParts(String(cell.value || "").trim()),
      week,
    }));

    if (time || lessons.length) {
      currentDay.slots.push({ time: time || currentTime, week, lessons });
    }
  });

  return {
    title,
    hasWeekSplit: days.some((day) =>
      day.slots.some((slot) => slot.lessons.some((lesson) => lesson.week === 2))
    ),
    days: days
      .map((day) => ({ ...day, slots: day.slots.filter((slot) => slot.lessons.length) }))
      .filter((day) => day.slots.length),
  };
}

function cleanDayName(value) {
  return String(value || "")
    .replace(/\s+\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function coversColumn(cell, col) {
  return col >= cell.col && col < cell.col + (cell.colSpan || 1);
}

function groupsForCell(cell, groupsByCol) {
  const labels = [];
  for (let col = cell.col; col < cell.col + (cell.colSpan || 1); col += 1) {
    const label = groupsByCol.get(col);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.join(", ");
}

function lessonParts(raw) {
  const parts = raw.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  return {
    subject: parts[0] || raw,
    teacher: parts[1] || "",
    place: parts.slice(2).join("\n"),
  };
}

function renderScheduleCards(model, query) {
  const activeWeek = model.hasWeekSplit ? selectedWeekNumber() : null;
  const days = model.days.map((day) => {
    const slots = mergeWeekSlots(day.slots)
      .map((slot) => ({ ...slot, lessons: filterLessonsByWeek(slot.lessons, activeWeek) }))
      .filter((slot) => slot.lessons.length)
      .map((slot) => {
      const lessons = slot.lessons.map((lesson) => {
        const searchableLesson = [lesson.groups, lesson.raw, lesson.parts.subject, lesson.parts.teacher, lesson.parts.place].join(" ");
        const match = query && matchesSearchText(searchableLesson, query);
        return `
          <article class="lesson-card${match ? " match" : ""}">
            <div class="lesson-topline">
              <span class="lesson-week ${lesson.week === 1 ? "numerator" : "denominator"}">
                ${lesson.week === 1 ? "числитель" : "знаменатель"}
              </span>
              <span class="lesson-group">${escapeHtml(lesson.groups)}</span>
            </div>
            <div class="lesson-subject">${escapeHtml(lesson.parts.subject)}</div>
            ${lesson.parts.teacher ? `<div class="lesson-teacher">${escapeHtml(lesson.parts.teacher)}</div>` : ""}
            ${lesson.parts.place ? `<div class="lesson-place">${escapeHtml(lesson.parts.place)}</div>` : ""}
          </article>
        `;
      }).join("");

      return `
        <div class="time-row">
          <div class="time-cell">${escapeHtml(slot.time)}</div>
          <div class="lesson-list">${lessons}</div>
        </div>
      `;
    }).join("");

    return `
      <section class="day-card">
        <h3>${escapeHtml(day.name)}</h3>
        <div class="day-slots">${slots}</div>
      </section>
    `;
  }).join("");

  els.content.innerHTML = `
    <div class="schedule-view cards-view">
      ${model.title ? `<div class="schedule-title">${escapeHtml(model.title)}</div>` : ""}
      <div class="week-note">${weekModeText(activeWeek)}</div>
      <div class="days-list">${days}</div>
    </div>
  `;
}

function mergeWeekSlots(slots) {
  const merged = [];
  slots.forEach((slot) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.time === slot.time) {
      previous.lessons.push(...slot.lessons);
    } else {
      merged.push({ time: slot.time, lessons: [...slot.lessons] });
    }
  });
  return merged;
}

function filterLessonsByWeek(lessons, activeWeek) {
  if (!activeWeek) return lessons;
  return lessons.filter((lesson) => lesson.week === activeWeek);
}

function selectedWeekNumber() {
  if (state.weekMode === "all") return null;
  if (state.weekMode === "numerator") return 1;
  if (state.weekMode === "denominator") return 2;
  return currentWeekInfo().week;
}

function weekModeText(activeWeek) {
  if (!activeWeek) return "Показаны занятия числителя и знаменателя.";
  return `Показана ${activeWeek === 1 ? "1 неделя: числитель" : "2 неделя: знаменатель"}.`;
}

function currentWeekInfo(date = new Date()) {
  const start = startOfWeek(new Date(2025, 11, 29));
  const current = startOfWeek(date);
  const diff = Math.round((current - start) / (7 * 24 * 60 * 60 * 1000));
  const week = ((diff % 2) + 2) % 2 === 0 ? 2 : 1;
  const end = new Date(current);
  end.setDate(current.getDate() + 6);
  return {
    week,
    range: `${formatDate(current)} - ${formatDate(end)}`,
  };
}

function startOfWeek(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatDate(date) {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
}

function trimSheetRows(rows) {
  const usedColumns = new Set();
  const usefulRows = [];

  rows.forEach((row) => {
    const hasValue = row.some((cell) => String(cell.value || "").trim());
    if (!hasValue) return;
    row.forEach((cell) => {
      if (String(cell.value || "").trim()) {
        for (let col = cell.col; col < cell.col + (cell.colSpan || 1); col += 1) {
          usedColumns.add(col);
        }
      }
    });
    usefulRows.push(row);
  });

  if (!usedColumns.size) return [];
  const maxUsedColumn = Math.max(...usedColumns);
  return usefulRows.map((row) => row.filter((cell) => cell.col <= maxUsedColumn));
}

function extractTitle(rows) {
  const firstValue = rows[0]?.find((cell) => String(cell.value || "").trim())?.value || "";
  return String(firstValue).trim();
}

function isHeaderCell(cell) {
  return cell.row <= 3 && cell.col > 2;
}

function isLessonCell(cell, value) {
  if (!value || cell.col <= 2 || cell.row <= 3) return false;
  return /-|[А-Яа-яA-Za-z]{3,}/.test(value);
}

els.search.addEventListener("input", () => {
  state.query = els.search.value.trim();
  if (state.tree) {
    renderTree();
  }
  if (state.workbook) renderWorkbook();
});

els.sectionsToggle?.addEventListener("click", () => {
  state.sectionsCollapsed = !state.sectionsCollapsed;
  updateSectionsCollapsed();
});

els.refresh.addEventListener("click", async () => {
  try {
    await loadTree(true);
  } catch (error) {
    setStatus(error.message);
  }
});

els.reloadFile.addEventListener("click", async () => {
  if (!state.selectedFile) return;
  try {
    await loadFile(state.selectedFile, true);
  } catch (error) {
    els.content.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
  }
});

updateSectionsCollapsed();

loadTree().catch((error) => {
  setStatus(error.message);
  els.tree.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
});
