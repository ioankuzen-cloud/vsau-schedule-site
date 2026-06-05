const state = {
  tree: null,
  files: [],
  data: null,
  selected: "",
  week: "current",
  query: "",
  filters: {
    semester: "II семестр",
    section: "Основное расписание",
  },
  indexCollapsed: localStorage.getItem("teacherIndexCollapsed") === "1",
  aggregateTimer: null,
};

const API_BASE = "/teachers";

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

if (window.location.protocol === "file:") {
  document.body.classList.add("file-mode");
}

const els = {
  semester: document.querySelector("#semesterSelect"),
  section: document.querySelector("#sectionSelect"),
  indexToggle: document.querySelector("#indexToggle"),
  load: document.querySelector("#loadBtn"),
  refresh: document.querySelector("#refreshTreeBtn"),
  search: document.querySelector("#searchInput"),
  status: document.querySelector("#status"),
  entityList: document.querySelector("#entityList"),
  scheduleMeta: document.querySelector("#scheduleMeta"),
  scheduleTitle: document.querySelector("#scheduleTitle"),
  scheduleContent: document.querySelector("#scheduleContent"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const DAY_ORDER = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

function daySortIndex(day) {
  const value = String(day || "").toLowerCase();
  const index = DAY_ORDER.findIndex((name) => value.includes(name));
  return index === -1 ? DAY_ORDER.length : index;
}

function timeToMinutes(time) {
  const match = String(time || "").match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 9999;
}

function splitGroupLabels(groups) {
  return String(groups || "")
    .split(/\s*,\s*/)
    .map((label) => label.trim())
    .filter(Boolean);
}

function parseGroupLabel(label) {
  const value = String(label || "").trim();
  const match = value.match(/^(.+?)\s*\/\s*([0-9a-zа-яё.-]+)$/i);
  if (!match) return { group: value, subgroup: "" };
  return { group: match[1].trim(), subgroup: match[2].trim() };
}

function groupedLabels(groups) {
  const grouped = new Map();
  splitGroupLabels(groups).forEach((label) => {
    const parsed = parseGroupLabel(label);
    if (!parsed.group) return;
    if (!grouped.has(parsed.group)) grouped.set(parsed.group, new Set());
    if (parsed.subgroup) grouped.get(parsed.group).add(parsed.subgroup);
  });
  return [...grouped.entries()].map(([group, subgroups]) => ({
    group,
    subgroups: [...subgroups].sort((a, b) => a.localeCompare(b, "ru", { numeric: true })),
  }));
}

function renderGroupBadges(groups) {
  const items = groupedLabels(groups);
  if (!items.length) return "";
  return `
    <div class="group-badges">
      ${items.map(({ group, subgroups }) => `
        <span class="group-chip">
          <span class="group-main">${escapeHtml(group)}</span>
          ${subgroups.length ? `<span class="subgroups">${escapeHtml(subgroups.join(", "))}</span>` : ""}
        </span>
      `).join("")}
    </div>
  `;
}

function updateIndexCollapsed() {
  document.body.classList.toggle("index-collapsed", state.indexCollapsed);
  if (els.indexToggle) {
    els.indexToggle.textContent = state.indexCollapsed ? "Показать список" : "Скрыть список";
    els.indexToggle.setAttribute("aria-expanded", String(!state.indexCollapsed));
  }
  localStorage.setItem("teacherIndexCollapsed", state.indexCollapsed ? "1" : "0");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function flattenFiles(node, trail = []) {
  if (!node) return [];
  if (node.type === "file") return [{ ...node, trail }];
  return (node.children || []).flatMap((child) => flattenFiles(child, [...trail, node.title]));
}

function pathParts(file) {
  return (file.trail || []).filter((part) => part && part !== state.tree?.title);
}

function optionMarkup(values, placeholder, selected) {
  return `
    <option value="">${escapeHtml(placeholder)}</option>
    ${values.map((value) => `
      <option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>
    `).join("")}
  `;
}

function filesForFilters() {
  return state.files.filter((file) => {
    const [, semester, section] = pathParts(file);
    if (state.filters.semester && semester !== state.filters.semester) return false;
    if (state.filters.section && section !== state.filters.section) return false;
    return ["xlsx", "xls", "xlsm"].includes((file.extension || "").toLowerCase());
  });
}

function renderFilters() {
  const semesters = unique(state.files.map((file) => pathParts(file)[1]));
  const sections = unique(state.files
    .filter((file) => !state.filters.semester || pathParts(file)[1] === state.filters.semester)
    .map((file) => pathParts(file)[2]));

  if (state.filters.section && !sections.includes(state.filters.section)) {
    state.filters.section = "";
  }
  if (state.filters.semester && !semesters.includes(state.filters.semester)) {
    state.filters.semester = semesters.includes("II семестр") ? "II семестр" : (semesters[0] || "");
  }

  els.semester.innerHTML = optionMarkup(semesters, "Все семестры", state.filters.semester);
  els.section.innerHTML = optionMarkup(sections, "Все разделы", state.filters.section);
}

async function loadTree(force = false) {
  els.status.textContent = force ? "Обновляю Google Drive..." : "Читаю структуру Google Drive...";
  const response = await fetch(apiUrl(`/api/tree${force ? "?refresh=1" : ""}`));
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Не удалось загрузить структуру");

  state.tree = payload.tree;
  state.files = flattenFiles(payload.tree);
  renderFilters();
  els.status.textContent = "Нажмите «Собрать расписание», чтобы получить список преподавателей.";
}

function pendingMessage(payload, filesCount) {
  const elapsed = Number(payload.elapsedSeconds || 0);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const elapsedText = elapsed > 0 ? ` Идет уже ${minutes}:${String(seconds).padStart(2, "0")}.` : "";
  return `Сервер собирает ${filesCount} файлов в фоне.${elapsedText} Результат появится автоматически.`;
}

async function loadAggregate(isPolling = false) {
  const files = filesForFilters();
  if (!files.length) {
    els.status.textContent = "По выбранным фильтрам нет файлов расписания.";
    return;
  }

  if (!isPolling) {
    window.clearTimeout(state.aggregateTimer);
    state.data = null;
    state.selected = "";
    renderEntities();
    els.scheduleTitle.textContent = "Собираю расписание...";
    els.scheduleContent.innerHTML = `<div class="notice">Разбираю ${files.length} файлов. На публичном сервере первая сборка может занять несколько минут.</div>`;
  }

  const params = new URLSearchParams({
    semester: state.filters.semester,
    section: state.filters.section,
  });
  const response = await fetch(apiUrl(`/api/aggregate?${params.toString()}`));
  const payload = await response.json();
  if (payload.pending) {
    const message = pendingMessage(payload, files.length);
    els.status.textContent = message;
    els.scheduleTitle.textContent = "Собираю расписание...";
    els.scheduleContent.innerHTML = `<div class="notice">${escapeHtml(message)}</div>`;
    state.aggregateTimer = window.setTimeout(() => loadAggregate(true).catch(showError), 8000);
    return;
  }
  if (!response.ok) throw new Error(payload.error || "Не удалось собрать расписание");

  window.clearTimeout(state.aggregateTimer);
  state.data = payload;
  els.status.textContent = `Файлов: ${payload.files.length}. Занятий: ${payload.lessons.length}. Преподавателей: ${payload.teachers.length}.`;
  renderEntities();
  renderSchedule();
}

function selectedWeekNumber() {
  if (state.week === "all") return null;
  if (state.week === "numerator") return 1;
  if (state.week === "denominator") return 2;
  return currentWeekInfo().week;
}

function currentWeekInfo(date = new Date()) {
  const start = startOfWeek(new Date(2025, 11, 29));
  const current = startOfWeek(date);
  const diff = Math.round((current - start) / (7 * 24 * 60 * 60 * 1000));
  return { week: ((diff % 2) + 2) % 2 === 0 ? 2 : 1 };
}

function startOfWeek(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function filteredLessons() {
  if (!state.data) return [];
  const week = selectedWeekNumber();
  const query = state.query.toLowerCase();

  return state.data.lessons.filter((lesson) => {
    if (week && lesson.week !== week) return false;
    if (state.selected && !lesson.teachers.includes(state.selected)) return false;
    if (!query) return true;
    return [
      lesson.subject,
      lesson.groups,
      lesson.day,
      lesson.time,
      lesson.fileTitle,
      ...(lesson.teachers || []),
      ...(lesson.rooms || []),
    ].join(" ").toLowerCase().includes(query);
  });
}

function lessonMatchesQuery(lesson, query) {
  if (!query) return true;
  return [
    lesson.subject,
    lesson.groups,
    lesson.day,
    lesson.time,
    lesson.fileTitle,
    lesson.faculty,
    lesson.section,
    ...(lesson.teachers || []),
    ...(lesson.rooms || []),
  ].join(" ").toLowerCase().includes(query);
}

function entityCounts() {
  const counts = new Map();
  const week = selectedWeekNumber();
  const query = state.query.toLowerCase();
  const source = state.data?.lessons || [];

  source.forEach((lesson) => {
    if (week && lesson.week !== week) return;
    if (!lessonMatchesQuery(lesson, query)) return;
    lesson.teachers.forEach((key) => counts.set(key, (counts.get(key) || 0) + 1));
  });

  return counts;
}

function renderEntities() {
  if (!state.data) {
    els.entityList.innerHTML = "";
    return;
  }

  const counts = entityCounts();
  const query = state.query.toLowerCase();
  const entities = state.data.teachers
    .filter((name) => !query || name.toLowerCase().includes(query) || counts.has(name))
    .sort((a, b) => a.localeCompare(b, "ru"));

  els.entityList.innerHTML = entities.map((name) => `
    <button class="entity-row${state.selected === name ? " active" : ""}" data-name="${escapeHtml(name)}" type="button">
      <span class="entity-name">${escapeHtml(name)}</span>
      <span class="entity-count">${counts.get(name) || 0} занятий</span>
    </button>
  `).join("") || `<div class="notice">Ничего не найдено.</div>`;

  els.entityList.querySelectorAll("[data-name]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selected = button.dataset.name;
      renderEntities();
      renderSchedule();
    });
  });
}

function renderSchedule() {
  if (!state.data) {
    els.scheduleTitle.textContent = "Выберите преподавателя";
    els.scheduleContent.innerHTML = `<div class="empty-state">После сборки слева появится список преподавателей по алфавиту.</div>`;
    return;
  }

  els.scheduleTitle.textContent = state.selected || "Выберите преподавателя";
  els.scheduleMeta.textContent = "Расписание преподавателя";

  if (!state.selected) {
    els.scheduleContent.innerHTML = `<div class="empty-state">Выберите преподавателя в списке слева.</div>`;
    return;
  }

  const lessons = filteredLessons().sort((a, b) =>
    daySortIndex(a.day) - daySortIndex(b.day) ||
    timeToMinutes(a.time) - timeToMinutes(b.time) ||
    String(a.groups || "").localeCompare(String(b.groups || ""), "ru", { numeric: true })
  );
  if (!lessons.length) {
    els.scheduleContent.innerHTML = `<div class="notice">Для выбранного фильтра занятий не найдено.</div>`;
    return;
  }

  const byDay = new Map();
  lessons.forEach((lesson) => {
    if (!byDay.has(lesson.day)) byDay.set(lesson.day, []);
    byDay.get(lesson.day).push(lesson);
  });

  els.scheduleContent.innerHTML = [...byDay.entries()]
    .sort((a, b) => daySortIndex(a[0]) - daySortIndex(b[0]))
    .map(([day, items]) => `
    <section class="day-card">
      <h3>${escapeHtml(day)}</h3>
      ${items.map(renderLesson).join("")}
    </section>
  `).join("");
}

function renderLesson(lesson) {
  const rooms = lesson.rooms.join(", ");
  const groups = splitGroupLabels(lesson.groups);
  return `
    <article class="lesson-row">
      <div class="time">${escapeHtml(lesson.time)}</div>
      <div class="lesson-card">
        <div class="lesson-top">
          <span class="week ${lesson.week === 1 ? "one" : "two"}">${lesson.weekLabel}</span>
          ${groups.length > 1 ? `<span class="combined-label">общая пара</span>` : ""}
          ${renderGroupBadges(groups)}
        </div>
        <div class="subject">${escapeHtml(lesson.subject)}</div>
        ${rooms ? `<div class="detail">${escapeHtml(rooms)}</div>` : ""}
        <div class="detail">${escapeHtml([lesson.faculty, lesson.fileTitle, lesson.section].filter(Boolean).join(" · "))}</div>
      </div>
    </article>
  `;
}

function showError(error) {
  window.clearTimeout(state.aggregateTimer);
  els.status.textContent = error.message;
  els.scheduleContent.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
}

els.semester.addEventListener("change", () => {
  window.clearTimeout(state.aggregateTimer);
  state.filters.semester = els.semester.value;
  state.filters.section = "Основное расписание";
  renderFilters();
});

els.section.addEventListener("change", () => {
  window.clearTimeout(state.aggregateTimer);
  state.filters.section = els.section.value;
});

els.load.addEventListener("click", () => {
  loadAggregate().catch(showError);
});

els.refresh.addEventListener("click", () => {
  loadTree(true).catch((error) => {
    els.status.textContent = error.message;
  });
});

els.search.addEventListener("input", () => {
  state.query = els.search.value.trim();
  renderEntities();
  renderSchedule();
});

els.indexToggle?.addEventListener("click", () => {
  state.indexCollapsed = !state.indexCollapsed;
  updateIndexCollapsed();
});

document.querySelectorAll("[data-week]").forEach((button) => {
  button.addEventListener("click", () => {
    state.week = button.dataset.week;
    document.querySelectorAll("[data-week]").forEach((item) => item.classList.toggle("active", item === button));
    renderEntities();
    renderSchedule();
  });
});

updateIndexCollapsed();

loadTree().catch((error) => {
  els.status.textContent = error.message;
});
