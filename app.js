const STORAGE_KEY = "PhotoOpsPreviewAssignmentsV1";
const TEAM_KEY = "PhotoOpsPreviewTeamAssignmentsV1";
const Schedule = PhotoOpsSchedule;
let teamAssignments = JSON.parse(localStorage.getItem(TEAM_KEY) || "[]");
let selectedCoworker = "";
const SETTINGS_KEY = "PhotoOpsPreviewSettingsV1";

let assignments = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{"displayName":"David Denk","leadTime":45,"dark":false}');

const $ = (id) => document.getElementById(id);
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

if (settings.dark) document.body.classList.add("dark");
$("displayName").value = settings.displayName || "David Denk";
$("nameFilter").value = settings.displayName || "David Denk";
$("defaultLeadTime").value = String(settings.leadTime || 45);

tabs.forEach(tab => tab.addEventListener("click", () => {
  tabs.forEach(t => t.classList.remove("active"));
  panels.forEach(p => p.classList.remove("active"));
  tab.classList.add("active");
  $(tab.dataset.tab).classList.add("active");
}));

$("themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  settings.dark = document.body.classList.contains("dark");
  saveSettings();
  renderTeam();
});

$("displayName").addEventListener("change", e => {
  settings.displayName = e.target.value.trim() || "David Denk";
  $("nameFilter").value = settings.displayName;
  saveSettings();
  renderTeam();
});

$("defaultLeadTime").addEventListener("change", e => {
  settings.leadTime = Number(e.target.value);
  saveSettings();
});

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function saveAssignments() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  renderAll();
}

function assignmentDateTime(a) {
  const time = a.startTime || "23:59";
  return new Date(`${a.date}T${time}:00`);
}

function formatDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
}

function formatTime(value) {
  if (!value) return "Time TBD";
  const [h,m] = value.split(":").map(Number);
  return new Date(2000,0,1,h,m).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
}

function createAssignmentCard(a, team = false) {
  a = Schedule.metadata(a);
  const template = $("assignmentTemplate").content.cloneNode(true);
  const article = template.querySelector(".assignment-card");
  const date = new Date(`${a.date}T12:00:00`);
  template.querySelector(".month").textContent = date.toLocaleDateString([], {month:"short"});
  template.querySelector(".day").textContent = date.getDate();
  template.querySelector("h3").textContent = a.school;
  const pill = template.querySelector(".status-pill");
  pill.textContent = a.status;
  pill.classList.add(`status-${a.status}`);
  template.querySelector(".time-line").textContent = `${formatDate(a.date)} • ${formatTime(a.startTime)}${a.endTime ? "–" + formatTime(a.endTime) : ""}`;
  template.querySelector(".location-line").textContent = [a.location, a.address].filter(Boolean).join(" • ") || "Location not entered";
  template.querySelector(".type-line").textContent = a.assignmentType;
  template.querySelector(".photographers-line").textContent = a.photographers.length ? `Photographers: ${a.photographers.join(", ")}` : "Photographers not identified";
  template.querySelector(".notes-line").textContent = [...new Set([a.notes, ...(a.sourceTexts || [])].filter(Boolean))].join("\n");
  template.querySelector(".details-btn").addEventListener("click", () => openDialog(a.id));

  if (team) template.querySelector(".details-btn").remove();

  const directions = template.querySelector(".directions-btn");
  if (a.address) {
    directions.href = `https://maps.apple.com/?q=${encodeURIComponent(a.address)}`;
  } else {
    directions.style.display = "none";
  }

  template.querySelector(".calendar-btn").addEventListener("click", () => downloadICS(a));
  article.dataset.id = a.id;
  return template;
}

function renderList(container, list, team = false) {
  container.innerHTML = "";
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">No assignments found.</div>';
    return;
  }
  list.forEach(a => container.appendChild(createAssignmentCard(a, team)));
}

function renderAll() {
  const sorted = [...assignments].sort((a,b) => assignmentDateTime(a) - assignmentDateTime(b));
  const now = new Date();
  const upcoming = sorted.filter(a => assignmentDateTime(a) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()));

  $("upcomingCount").textContent = upcoming.length;
  $("trainingCount").textContent = assignments.filter(a => a.status === "training").length;
  $("tentativeCount").textContent = assignments.filter(a => ["tentative","tbd"].includes(a.status)).length;

  renderList($("dashboardList"), upcoming.slice(0,6));
  applyScheduleFilters();
  renderTeam();

  const next = upcoming[0];
  $("nextAssignment").innerHTML = next
    ? `<h2>${escapeHtml(next.school)}</h2>
       <p>${formatDate(next.date)} • ${formatTime(next.startTime)}${next.endTime ? "–"+formatTime(next.endTime) : ""}</p>
       <p>${escapeHtml([next.location, next.address].filter(Boolean).join(" • ") || "Location not entered")}</p>`
    : `<h2>No upcoming assignment</h2><p>Import or add your schedule to get started.</p>`;
}

function escapeHtml(value="") {
  return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function applyScheduleFilters() {
  const term = $("searchInput").value.toLowerCase().trim();
  const status = $("statusFilter").value;
  const list = [...assignments]
    .filter(a => status === "all" || a.status === status)
    .filter(a => [a.school,a.location,a.address,a.notes].join(" ").toLowerCase().includes(term))
    .sort((a,b) => assignmentDateTime(a) - assignmentDateTime(b));
  renderList($("scheduleList"), list);
}

$("searchInput").addEventListener("input", applyScheduleFilters);
$("statusFilter").addEventListener("change", applyScheduleFilters);

function openDialog(id=null) {
  const a = assignments.find(x => x.id === id);
  $("dialogTitle").textContent = a ? "Edit Assignment" : "Add Assignment";
  $("editId").value = a?.id || "";
  $("school").value = a?.school || "";
  $("date").value = a?.date || new Date().toISOString().slice(0,10);
  $("startTime").value = a?.startTime || "";
  $("endTime").value = a?.endTime || "";
  $("status").value = a?.status || "confirmed";
  $("location").value = a?.location || "";
  $("address").value = a?.address || "";
  $("notes").value = a?.notes || "";
  $("deleteAssignmentBtn").style.display = a ? "inline-block" : "none";
  $("assignmentDialog").showModal();
}

$("addManualBtn").addEventListener("click", () => openDialog());

// Dismiss without submitting, validating, or changing saved assignments.
["closeAssignmentBtn", "cancelAssignmentBtn"].forEach(id => {
  $(id).addEventListener("click", () => $("assignmentDialog").close("cancel"));
});

$("assignmentForm").addEventListener("submit", e => {
  e.preventDefault();
  const id = $("editId").value || crypto.randomUUID();
  const item = {
    ...assignments.find(a => a.id === id),
    id,
    school: $("school").value.trim(),
    date: $("date").value,
    startTime: $("startTime").value,
    endTime: $("endTime").value,
    status: $("status").value,
    location: $("location").value.trim(),
    address: $("address").value.trim(),
    notes: $("notes").value.trim()
  };
  const index = assignments.findIndex(a => a.id === id);
  if (index >= 0) assignments[index] = item; else assignments.push(item);
  saveAssignments();
  $("assignmentDialog").close();
});

$("deleteAssignmentBtn").addEventListener("click", () => {
  const id = $("editId").value;
  if (id && confirm("Delete this assignment?")) {
    assignments = assignments.filter(a => a.id !== id);
    saveAssignments();
    $("assignmentDialog").close();
  }
});

// Legacy personal records remain under their original key and are never rewritten on load.
// Team metadata is derived from old notes in memory; new imports use a separate key.
function allTeamAssignments() {
  return Schedule.merge(teamAssignments, assignments.map(Schedule.metadata));
}

function renderTeam() {
  const all = allTeamAssignments();
  const filter = $("teamTypeFilter");
  const previous = filter.value || "all";
  filter.replaceChildren(new Option("All assignment types", "all"));
  [...new Set(all.map(a => Schedule.metadata(a).assignmentType))].sort().forEach(type => filter.add(new Option(type, type)));
  filter.value = [...filter.options].some(o => o.value === previous) ? previous : "all";
  const people = Schedule.directory(all, settings.displayName, $("teamSearch").value, filter.value);
  const directory = $("teamDirectory");
  directory.replaceChildren();
  people.forEach(person => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-btn coworker-btn";
    button.textContent = `${person.name} · ${person.assignments.length} assignment${person.assignments.length === 1 ? "" : "s"}`;
    button.setAttribute("aria-pressed", String(Schedule.key(selectedCoworker) === Schedule.key(person.name)));
    button.addEventListener("click", () => { selectedCoworker = person.name; renderTeam(); });
    directory.appendChild(button);
  });
  if (!people.length) directory.textContent = "No coworkers match. Import a schedule with a photographer roster to get started.";
  const selected = people.find(p => Schedule.key(p.name) === Schedule.key(selectedCoworker));
  $("teamAssignmentsHeading").textContent = selected ? `${selected.name} — Assignments` : "Select a coworker";
  $("teamAssignments").replaceChildren();
  if (selected) renderList($("teamAssignments"), selected.assignments.sort((a,b) => assignmentDateTime(a)-assignmentDateTime(b)), true);
  const unresolved = teamAssignments.filter(a => !Schedule.metadata(a).photographers.length);
  $("teamUnresolvedSummary").textContent = `${unresolved.length} assignment${unresolved.length === 1 ? "" : "s"} without identified photographers`;
  renderList($("teamUnresolved"), unresolved, true);
}

$("teamSearch").addEventListener("input", renderTeam);
$("teamTypeFilter").addEventListener("change", renderTeam);

$("importBtn").addEventListener("click", () => {
  const text = $("scheduleText").value.trim();
  const name = $("nameFilter").value.trim();
  if (!text || !name) {
    $("importMessage").textContent = "Paste a schedule and enter your name first.";
    return;
  }
  const parsed = Schedule.parse(text);
  const personal = parsed.filter(a => a.photographers.some(n => Schedule.key(n) === Schedule.key(name)));
  const nextTeam = Schedule.merge(teamAssignments, parsed);
  const nextPersonal = Schedule.merge(assignments, personal);
  // Write the independent Team store first; never replace personal data with coworker rows.
  try {
    localStorage.setItem(TEAM_KEY, JSON.stringify(nextTeam));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPersonal));
  } catch {
    $("importMessage").textContent = "Could not save the import. Storage may be full; export a backup and retry.";
    return;
  }
  teamAssignments = nextTeam;
  assignments = nextPersonal;
  renderAll();
  const unresolved = parsed.filter(a => !a.photographers.length).length;
  $("importMessage").textContent = `Processed ${parsed.length} assignments: ${personal.length} for ${name}. Team updated; ${unresolved} without identified photographers (review in Team).`;
});

$("sampleBtn").addEventListener("click", () => {
  $("scheduleText").value = `Mon, Aug 3
**C** Hickory HS SR27 MU - 9:00am last appt@1:20pm- (Gray bkgd) - gym foyer - Tripp, Angel, Connor, Ahmed, Ramsay, Monica, Ben, David Denk (training)
Tue, Aug 4
**C** Jamestown HS SR27 MU -9:00am last appt@1:20pm - cafeteria - Tripp, Ahmed, Monica, Ramsay, Stacy, David Denk (training)
Thu, Aug 20
Woodside HS Fall Sportsmates - 4:00pm - pending approval - Tripp, Ahmed, Ramsay, Monica, David Denk`;
});

function downloadICS(a) {
  const start = a.startTime || "09:00";
  const end = a.endTime || addMinutes(start, 120);
  const dtStart = `${a.date.replaceAll("-","")}T${start.replace(":","")}00`;
  const dtEnd = `${a.date.replaceAll("-","")}T${end.replace(":","")}00`;
  const body = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Denk Hub//EN","BEGIN:VEVENT",
    `UID:${a.id}@denk-hub`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(a.school)}`,
    `LOCATION:${icsEscape([a.location,a.address].filter(Boolean).join(", "))}`,
    `DESCRIPTION:${icsEscape(a.notes || "")}`,
    "END:VEVENT","END:VCALENDAR"
  ].join("\r\n");
  downloadBlob(`${a.school.replace(/[^a-z0-9]+/gi,"-")}.ics`, body, "text/calendar");
}

function addMinutes(time, mins) {
  const [h,m] = time.split(":").map(Number);
  const date = new Date(2000,0,1,h,m+mins);
  return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
}
function icsEscape(v="") { return v.replace(/([,;])/g,"\\$1").replace(/\n/g,"\\n"); }
function downloadBlob(name, content, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("exportBtn").addEventListener("click", () => {
  downloadBlob("denk-hub-backup.json", JSON.stringify({schemaVersion:2,assignments,teamAssignments,settings}, null, 2), "application/json");
});

$("backupInput").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.assignments) || (data.teamAssignments !== undefined && !Array.isArray(data.teamAssignments))) throw new Error("Invalid backup");
    const mergedTeam = Schedule.merge(teamAssignments, data.teamAssignments || []);
    const mergedPersonal = Schedule.merge(assignments, data.assignments);
    localStorage.setItem(TEAM_KEY, JSON.stringify(mergedTeam));
    teamAssignments = mergedTeam;
    assignments = mergedPersonal;
    settings = data.settings || settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    saveAssignments();
    alert("Backup imported.");
  } catch {
    alert("That backup file could not be read.");
  }
});

$("clearBtn").addEventListener("click", () => {
  if (confirm("Clear every saved assignment?")) {
    localStorage.setItem(TEAM_KEY, "[]");
    teamAssignments = [];
    assignments = [];
    saveAssignments();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

renderAll();
