const Planner = PhotoOpsPlanner;
const Store = PhotoOpsStore;
// Complete or roll back an interrupted two-store backup restoration before reading data.
Store.recover(localStorage);
const SCHOOLS_KEY = "PhotoOpsPreviewSchoolsV1";
let loadedSchoolsRaw = localStorage.getItem(SCHOOLS_KEY);
let schools = JSON.parse(loadedSchoolsRaw || "[]");
let lastSuggestedAddress = null;
const STORAGE_KEY = "PhotoOpsPreviewAssignmentsV1";
const Sync = PhotoOpsSync;
const BACKUP_PREFIX = "PhotoOpsPreviewSyncBackupV21:";
const ATTENTION_KEY="PhotoOpsPreviewImportAttentionV21";
let attention=JSON.parse(localStorage.getItem(ATTENTION_KEY) || "[]");
const SETTINGS_KEY = "PhotoOpsPreviewSettingsV1";

let loadedRaw = localStorage.getItem(STORAGE_KEY);
let assignments = JSON.parse(loadedRaw || "[]");
let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{"displayName":"","aliases":[],"importMode":"mine","dark":false}');

const $ = (id) => document.getElementById(id);
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

if (settings.dark) document.body.classList.add("dark");
$("displayName").value = settings.displayName || "";
$("nameFilter").value = settings.displayName || "";
$("nameAliases").value = (settings.aliases || []).join("\n");
$("importMode").value = settings.importMode === "all" ? "all" : "mine";
$("viewDate").value = Planner.iso(new Date());

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
});

$("displayName").addEventListener("change", e => {
  settings.displayName = e.target.value.trim();
  cancelPreview();
  $("nameFilter").value = settings.displayName;
  saveSettings();
});

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function saveAssignments(next) {
  if(localStorage.getItem(STORAGE_KEY) !== loadedRaw) throw new Error("Another tab changed assignments. Reload before saving to avoid overwriting its changes.");
  const raw=JSON.stringify(next);
  localStorage.setItem(STORAGE_KEY,raw);
  loadedRaw=raw; assignments=next; renderAll();
}

// A single localStorage replacement commits the assignment array atomically.
// Keep a durable exact pre-write snapshot; quota errors stop the write.
async function commitBulk(next, expected, nextSchools, expectedSchools, nextAttention, expectedAttention) {
  const commit = () => {
    if (localStorage.getItem(STORAGE_KEY) !== expected) throw new Error("Saved assignments changed. Preview the schedule again before applying it.");
    const backup = {createdAt:new Date().toISOString(),assignmentsRaw:expected,settingsRaw:localStorage.getItem(SETTINGS_KEY),schoolsRaw:localStorage.getItem(SCHOOLS_KEY),attentionRaw:localStorage.getItem(ATTENTION_KEY)};
    localStorage.setItem(BACKUP_PREFIX + backup.createdAt + ":" + crypto.randomUUID(), JSON.stringify(backup));
    if (localStorage.getItem(STORAGE_KEY) !== expected) throw new Error("Another tab changed assignments. Preview again.");
    const writes={[STORAGE_KEY]:JSON.stringify(next)};
    const check={[STORAGE_KEY]:expected};
    if(nextSchools !== undefined) { writes[SCHOOLS_KEY]=JSON.stringify(nextSchools); check[SCHOOLS_KEY]=expectedSchools; }
    if(nextAttention !== undefined) {writes[ATTENTION_KEY]=JSON.stringify(nextAttention);check[ATTENTION_KEY]=expectedAttention;}
    Store.transaction(localStorage,check,writes);
    if(nextAttention !== undefined) {attention=nextAttention;renderAttention();}
    if(nextSchools !== undefined) { schools=nextSchools; loadedSchoolsRaw=localStorage.getItem(SCHOOLS_KEY); renderSchools(); }
    assignments = next; loadedRaw=localStorage.getItem(STORAGE_KEY);
    renderAll();
  };
  if (navigator.locks) await navigator.locks.request("PhotoOpsPreviewAssignments", commit);
  else commit();
}

$("nameAliases").addEventListener("change", () => { settings.aliases = $("nameAliases").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean); saveSettings(); cancelPreview(); });
$("importMode").addEventListener("change", () => { settings.importMode = $("importMode").value; saveSettings(); cancelPreview(); });
$("scheduleFile").addEventListener("change", async e => {
  const file=e.target.files[0]; if (!file) return;
  try { $("scheduleText").value=await file.text(); cancelPreview(); }
  catch { $("importMessage").textContent="The schedule file could not be read."; }
});
$("scheduleText").addEventListener("input", cancelPreview);
$("nameFilter").addEventListener("input", cancelPreview);
$("syncBackupBtn").addEventListener("click", () => {
  const keys=Object.keys(localStorage).filter(k=>k.startsWith(BACKUP_PREFIX)).sort();
  if(!keys.length) { alert("No safety backups yet. One is saved before synchronization or backup restoration."); return; }
  const backup=JSON.parse(localStorage.getItem(keys.at(-1)));
  downloadBlob("photoops-safety-backup.json",JSON.stringify({assignments:JSON.parse(backup.assignmentsRaw || "[]"),settings:JSON.parse(backup.settingsRaw || "{}"),schools:JSON.parse(backup.schoolsRaw || "[]"),attention:JSON.parse(backup.attentionRaw || "[]"),createdAt:backup.createdAt},null,2),"application/json");
});

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

function createAssignmentCard(a) {
  const template = $("assignmentTemplate").content.cloneNode(true);
  const article = template.querySelector(".assignment-card");
  const date = new Date(`${a.date}T12:00:00`);
  template.querySelector(".month").textContent = date.toLocaleDateString([], {month:"short"});
  template.querySelector(".day").textContent = date.getDate();
  template.querySelector("h3").textContent = a.school;
  const pill = template.querySelector(".status-pill");
  const status = ["confirmed","training","tentative","tbd"].includes(a.status) ? a.status : "tbd";
  pill.textContent = a.status || status;
  pill.classList.add(`status-${status}`);
  template.querySelector(".time-line").textContent = `${formatDate(a.date)} • ${formatTime(a.startTime)}${a.endTime ? "–" + formatTime(a.endTime) : ""}`;
  template.querySelector(".location-line").textContent = [a.location, a.address].filter(Boolean).join(" • ") || "Location not entered";
  template.querySelector(".sync-line").textContent = [a.arrivalTime ? `Arrival ${formatTime(a.arrivalTime)}` : "", a.assignmentType, (a.photographers || []).join(", "), a.sync?.lastImportedAt ? `Imported ${new Date(a.sync.lastImportedAt).toLocaleString()}` : ""].filter(Boolean).join(" • ");
  template.querySelector(".notes-line").textContent = a.notes || "";
  template.querySelector(".details-btn").addEventListener("click", () => openDialog(a.id));

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

function renderList(container, list) {
  container.innerHTML = "";
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">No assignments found.</div>';
    return;
  }
  list.forEach(a => container.appendChild(createAssignmentCard(a)));
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

function saveSchools(next) {
  const backup={createdAt:new Date().toISOString(),assignmentsRaw:localStorage.getItem(STORAGE_KEY),settingsRaw:localStorage.getItem(SETTINGS_KEY),schoolsRaw:localStorage.getItem(SCHOOLS_KEY),attentionRaw:localStorage.getItem(ATTENTION_KEY)};
  if(backup.schoolsRaw!==loadedSchoolsRaw)throw new Error("The school directory changed in another tab. Reload before saving.");
  localStorage.setItem(BACKUP_PREFIX+backup.createdAt+":"+crypto.randomUUID(),JSON.stringify(backup));
  Store.transaction(localStorage,{[SCHOOLS_KEY]:loadedSchoolsRaw},{[SCHOOLS_KEY]:JSON.stringify(next)});
  schools=next;loadedSchoolsRaw=localStorage.getItem(SCHOOLS_KEY);renderSchools();
}
function schoolSuggestion(school) {return `${school.name} — ${school.city}, ${school.state} (${school.zip})`;}
function renderSchools() {
  const list=Planner.searchSchools(schools,$("schoolSearch").value);
  $("schoolCount").textContent=`${list.length} saved school${list.length===1?"":"s"}`;
  const directory=$("schoolDirectory");directory.replaceChildren();
  if(!list.length) {const empty=document.createElement("p");empty.className="empty-state";empty.textContent=schools.length?"No schools match your search.":"No schools saved yet. Add a school to reuse its address.";directory.append(empty);}
  for(const school of list) {
    const card=document.createElement("article");card.className="form-card";card.dataset.schoolId=school.id;
    const title=document.createElement("h3");title.textContent=school.name;
    const address=document.createElement("p");address.textContent=Planner.schoolAddress(school);
    const phone=document.createElement("p");phone.textContent=school.phone || "";
    const notes=document.createElement("p");notes.textContent=school.notes || "";
    const actions=document.createElement("div");actions.className="button-row";
    const edit=document.createElement("button");edit.type="button";edit.className="secondary-btn";edit.textContent="Edit";edit.setAttribute("aria-label",`Edit ${school.name}`);edit.addEventListener("click",()=>openSchoolDialog(school.id));
    const directions=document.createElement("a");directions.className="secondary-btn";directions.textContent="Directions";directions.href=`https://maps.apple.com/?q=${encodeURIComponent(Planner.schoolAddress(school))}`;directions.target="_blank";directions.rel="noopener";
    const remove=document.createElement("button");remove.type="button";remove.className="danger-btn";remove.textContent="Remove";remove.setAttribute("aria-label",`Remove ${school.name}`);
    remove.addEventListener("click",()=>{if(confirm(`Remove ${school.name} from the directory? Existing assignments and their addresses will remain unchanged.`))try {saveSchools(schools.filter(s=>s.id!==school.id));}catch(error){alert(`School removal stopped: ${error.message}`);}});
    actions.append(edit,directions,remove);card.append(title,address,phone,notes,actions);directory.append(card);
  }
  $("schoolSuggestions").replaceChildren();
  for(const school of [...schools].sort((a,b)=>a.name.localeCompare(b.name))) {const option=document.createElement("option");option.value=schoolSuggestion(school);$("schoolSuggestions").append(option);}
}
function openSchoolDialog(id) {
  const school=schools.find(s=>s.id===id);
  $("schoolDialogTitle").textContent=school?"Edit School":"Add School";$("schoolEditId").value=school?.id || "";
  for(const [field,id] of [["name","schoolName"],["address","schoolAddress"],["city","schoolCity"],["state","schoolState"],["zip","schoolZip"],["phone","schoolPhone"],["notes","schoolNotes"]])$(id).value=school?.[field] || "";
  $("schoolMessage").textContent="";$("schoolDialog").showModal();
}
$("schoolSearch").addEventListener("input",renderSchools);
$("addSchoolBtn").addEventListener("click",()=>openSchoolDialog());
for(const id of ["closeSchoolBtn","cancelSchoolBtn"])$(id).addEventListener("click",()=>$("schoolDialog").close());
$("schoolForm").addEventListener("submit",event=>{
  event.preventDefault();const id=$("schoolEditId").value || crypto.randomUUID();const school={...schools.find(s=>s.id===id),id};
  for(const [field,id] of [["name","schoolName"],["address","schoolAddress"],["city","schoolCity"],["state","schoolState"],["zip","schoolZip"],["phone","schoolPhone"],["notes","schoolNotes"]])school[field]=$(id).value.trim();
  try {saveSchools(Planner.saveSchool(schools,school));$("schoolDialog").close();}
  catch(error) {$("schoolMessage").textContent=error.message;}
});
$("school").addEventListener("input",()=>{$("assignmentSchoolId").value="";});
$("address").addEventListener("input",()=>{lastSuggestedAddress=null;});
$("school").addEventListener("change",()=>{
  const value=Planner.norm($("school").value);
  const matches=schools.filter(s=>Planner.norm(schoolSuggestion(s))===value || Planner.norm(s.name)===value);
  if(matches.length!==1)return;
  const school=matches[0],address=Planner.schoolAddress(school),current=$("address").value;
  $("school").value=school.name;$("assignmentSchoolId").value=school.id;
  if(current && current!==lastSuggestedAddress && Planner.norm(current)!==Planner.norm(address) && !confirm("Replace this assignment's custom address with the saved school address? Choose Cancel to keep your address."))return;
  $("address").value=address;lastSuggestedAddress=address;
});

function refreshFilterOptions() {
  for(const [id,values,first] of [["schoolFilter",assignments.map(a=>a.school),"All schools"],["typeFilter",assignments.map(a=>a.assignmentType).filter(Boolean),"All types"]]) {
    const select=$(id),previous=select.value;
    select.replaceChildren(new Option(first,""));
    [...new Map(values.map(v=>[Planner.norm(v),v])).values()].sort((a,b)=>a.localeCompare(b)).forEach(v=>select.add(new Option(v,v)));
    // Keep an active value even if a sync removed the last matching occurrence.
    if(previous && ![...select.options].some(o=>o.value===previous))select.add(new Option(previous,previous));
    select.value=previous;
  }
}
function chooseCalendarDay(value) {
  $("viewDate").value=value; $("scheduleView").value="day"; applyScheduleFilters();
}
function calendarEvent(a) {
  const button=document.createElement("button");button.type="button";button.className="calendar-event";
  button.textContent=`${a.startTime ? formatTime(a.startTime) : a.arrivalTime ? "Arrival " + formatTime(a.arrivalTime) : "Time TBD"} · ${a.school}`;
  button.setAttribute("aria-label",`${a.school}, ${formatDate(a.date)}, ${a.startTime || "time TBD"}, view assignment details`);
  button.addEventListener("click",()=>openDialog(a.id));return button;
}
function renderCalendar(list,view,anchor) {
  const container=$("calendarView");container.replaceChildren();
  $("scheduleList").hidden=view!=="all";
  if(view==="all") { $("calendarHeading").textContent="All assignments"; if(list.length)renderList($("scheduleList"),list);else $("scheduleList").replaceChildren();return; }
  $("scheduleList").replaceChildren();
  $("calendarHeading").textContent=view==="month"?PlannerDate(anchor).toLocaleDateString(undefined,{month:"long",year:"numeric"}):view==="week"?`${formatDate(Planner.monday(anchor))} – ${formatDate(Planner.addDays(Planner.monday(anchor),6))}`:formatDate(anchor);
  if(view==="day") {
    const timeline=document.createElement("ol");timeline.className="day-timeline";timeline.setAttribute("aria-label","Daily assignment timeline");
    for(const a of list) {
      const row=document.createElement("li");const clock=document.createElement("time");clock.textContent=a.startTime?formatTime(a.startTime):a.arrivalTime?"Arrival "+formatTime(a.arrivalTime):"Time TBD";
      if(a.startTime || a.arrivalTime)clock.dateTime=a.date+"T"+(a.startTime || a.arrivalTime);
      row.append(clock,createAssignmentCard(a));timeline.append(row);
    }
    container.append(timeline);return;
  }
  const scroll=document.createElement("div");scroll.className="calendar-scroll";scroll.tabIndex=0;scroll.setAttribute("role","region");scroll.setAttribute("aria-label",view==="week"?"Seven-day calendar; scroll horizontally on small screens":"Monthly calendar");
  const grid=document.createElement("div");grid.className=`calendar-grid calendar-${view}`;
  const dates=Planner.days(anchor,view),today=Planner.iso(new Date());
  if(view==="month") for(const name of ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]) {const head=document.createElement("div");head.className="weekday";head.textContent=name;grid.append(head);}
  for(const day of dates) {
    const cell=document.createElement("section");cell.className="calendar-day";cell.dataset.date=day;
    if(day===today)cell.classList.add("is-today");
    if(view==="month" && day.slice(0,7)!==anchor.slice(0,7))cell.classList.add("outside-month");
    const heading=document.createElement("button");heading.type="button";heading.className="calendar-date";
    heading.textContent=view==="week"?PlannerDate(day).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"}):String(PlannerDate(day).getDate());
    heading.setAttribute("aria-label",`View day ${formatDate(day)}`);if(day===today)heading.setAttribute("aria-current","date");
    heading.addEventListener("click",()=>chooseCalendarDay(day));cell.append(heading);
    const events=list.filter(a=>a.date===day);
    if(events.length) {const count=document.createElement("span");count.className="calendar-count";count.setAttribute("aria-label",`${events.length} assignment${events.length===1?"":"s"}`);
      const number=document.createElement("span");number.textContent=String(events.length);const word=document.createElement("span");word.className="calendar-count-word";word.textContent=` assignment${events.length===1?"":"s"}`;count.append(number,word);cell.append(count);}
    (view==="month"?events.slice(0,2):events).forEach(a=>cell.append(calendarEvent(a)));
    if(view==="month" && events.length>2) {const more=document.createElement("button");more.type="button";more.className="calendar-date";more.textContent=`+${events.length-2} more`;more.addEventListener("click",()=>chooseCalendarDay(day));cell.append(more);}
    grid.append(cell);
  }
  scroll.append(grid);
  if(view==="week") {const hint=document.createElement("p");hint.className="calendar-scroll-hint";hint.textContent="Swipe or scroll horizontally to see all seven days.";container.append(hint);}
  container.append(scroll);
}
const PlannerDate=value=>new Date(value+"T12:00:00");
function applyScheduleFilters() {
  refreshFilterOptions();
  const start=$("filterStart").value,end=$("filterEnd").value;
  const view=$("scheduleView").value,anchor=$("viewDate").value || Planner.iso(new Date());
  const invalid=start && end && start>end;
  const list=invalid?[]:Planner.filter(assignments,{search:$("searchInput").value,status:$("statusFilter").value,school:$("schoolFilter").value,start,end,type:$("typeFilter").value,view,anchor});
  $("filterCount").textContent=`${list.length} matching assignment${list.length===1?"":"s"}${view!=="all"?" in this calendar period":" across all dates"}`;
  $("filterEmpty").hidden=!!list.length;
  $("filterEmpty").textContent=invalid?"Start date must be on or before end date.":"No assignments match. Try another date or view, or reset your filters.";
  renderCalendar(list,view,anchor);
}
for(const id of ["scheduleView","viewDate","statusFilter","schoolFilter","typeFilter","filterStart","filterEnd"])$(id).addEventListener("change",applyScheduleFilters);
$("searchInput").addEventListener("input",applyScheduleFilters);
$("resetFilters").addEventListener("click",()=>{
  for(const id of ["searchInput","schoolFilter","typeFilter","filterStart","filterEnd"])$(id).value="";
  $("statusFilter").value="all";applyScheduleFilters();
});
for(const [id,direction] of [["calendarPrevious",-1],["calendarNext",1]])$(id).addEventListener("click",()=>{
  if($("scheduleView").value==="all")$("scheduleView").value="day";
  $("viewDate").value=Planner.navigate($("viewDate").value || Planner.iso(new Date()),$("scheduleView").value,direction);applyScheduleFilters();
});
$("calendarToday").addEventListener("click",()=>{
  $("viewDate").value=Planner.iso(new Date());if($("scheduleView").value==="all")$("scheduleView").value="day";applyScheduleFilters();
});

function openDialog(id=null) {
  const a = assignments.find(x => x.id === id);
  $("dialogTitle").textContent = a ? "Edit Assignment" : "Add Assignment";
  $("editId").value = a?.id || "";
  $("school").value = a?.school || "";
  $("assignmentSchoolId").value = a?.schoolId || "";
  lastSuggestedAddress=null;
  $("date").value = a?.date || Planner.iso(new Date());
  $("startTime").value = a?.startTime || "";
  $("endTime").value = a?.endTime || "";
  $("status").value = a?.status || "confirmed";
  $("location").value = a?.location || "";
  $("address").value = a?.address || "";
  $("notes").value = a?.notes || "";
  $("arrivalTime").value = a?.arrivalTime || "";
  $("assignmentType").value = a?.assignmentType || "";
  $("photographers").value = (a?.photographers || []).join(", ");
  $("contacts").value = typeof a?.contacts === "string" ? a.contacts : (a?.contacts == null ? "" : JSON.stringify(a.contacts));
  $("importedInfo").textContent = [a?.scheduleNotes,a?.scheduleDetails].filter(Boolean).join("\n\n") || "No imported schedule information.";
  $("assignmentHistory").replaceChildren();
  (a?.history || []).forEach((event,index) => {
    const button=document.createElement("button"); button.type="button"; button.className="secondary-btn";
    button.textContent=`Restore values before ${event.kind} — ${new Date(event.at).toLocaleString()}`;
    button.addEventListener("click", async () => {
      if(!confirm("Restore this assignment's previous values? A safety backup will be saved first.")) return;
      const expected=localStorage.getItem(STORAGE_KEY);
      try {
        if(JSON.stringify(JSON.parse(expected || "[]")) !== JSON.stringify(assignments)) throw new Error("Data changed in another tab. Reload before restoring.");
        const restored=Sync.restore(assignments.find(x=>x.id===id),index);
        await commitBulk(assignments.map(x=>x.id===id?restored:x),expected);
        $("assignmentDialog").close(); cancelPreview();
      } catch(error) { alert(`Restore stopped: ${error.message}`); }
    });
    $("assignmentHistory").appendChild(button);
  });
  $("dialogCalendarBtn").hidden=!a;
  $("deleteAssignmentBtn").style.display = a ? "inline-block" : "none";
  $("assignmentDialog").showModal();
}

$("dialogCalendarBtn").addEventListener("click",()=>{const a=assignments.find(a=>a.id===$("editId").value);if(a)downloadICS(a);});
$("addManualBtn").addEventListener("click", () => openDialog());

// Dismiss without submitting, validating, or changing saved assignments.
["closeAssignmentBtn", "cancelAssignmentBtn"].forEach(id => {
  $(id).addEventListener("click", () => $("assignmentDialog").close("cancel"));
});

$("assignmentForm").addEventListener("submit", e => {
  e.preventDefault();
  const id = $("editId").value || crypto.randomUUID();
  const previous = assignments.find(a => a.id === id);
  const item = {
    ...previous,
    id,
    arrivalTime: $("arrivalTime").value,
    assignmentType: $("assignmentType").value.trim(),
    photographers: $("photographers").value.split(",").map(s=>s.trim()).filter(Boolean),
    contacts: previous && $("contacts").value === (typeof previous.contacts === "string" ? previous.contacts : (previous.contacts == null ? "" : JSON.stringify(previous.contacts))) ? previous.contacts : $("contacts").value,
    school: $("school").value.trim(),
    schoolId: $("assignmentSchoolId").value || undefined,
    date: $("date").value,
    startTime: $("startTime").value,
    endTime: $("endTime").value,
    status: $("status").value,
    location: $("location").value.trim(),
    address: $("address").value.trim(),
    notes: $("notes").value.trim()
  };
  item.manualFields = [...new Set([...(previous?.manualFields || []), ...Sync.fields.filter(f => previous && !Sync.equal(previous[f], item[f]))])];
  const index = assignments.findIndex(a => a.id === id);
  const next=assignments.slice();
  if (index >= 0) next[index] = item; else next.push(item);
  try { saveAssignments(next); $("assignmentDialog").close(); cancelPreview(); }
  catch(error) { alert(`Save stopped: ${error.message}`); }
});

$("deleteAssignmentBtn").addEventListener("click", () => {
  const id = $("editId").value;
  if (id && confirm("Delete this assignment?")) {
    try { saveAssignments(assignments.filter(a => a.id !== id)); $("assignmentDialog").close(); cancelPreview(); }
    catch(error) { alert(`Delete stopped: ${error.message}`); }
  }
});

function cancelPreview() { $("importMessage").textContent=""; }
function renderAttention() {
  $("importAttention").hidden=!attention.length;
  $("attentionSummary").textContent=`${attention.length} saved item${attention.length===1?"":"s"} need attention (optional)`;
  $("attentionItems").replaceChildren();
  for(const item of attention) {
    const article=document.createElement("article");article.className="sync-row";
    const text=document.createElement("p");text.textContent=[item.incoming?.school,item.incoming?.date,item.message].filter(Boolean).join(" — ");article.append(text);
    const decision=document.createElement("select");decision.setAttribute("aria-label",`Match saved assignment for ${item.incoming?.school || 'item'}`);
    decision.add(new Option("Choose a saved assignment",""));
    for(const id of item.candidates || []) {const a=assignments.find(a=>a.id===id);if(a)decision.add(new Option(`${a.school} — ${a.date} ${a.startTime || ''}`,id));}
    async function resolve(action) {
      if(action==='update' && !decision.value)return;
      if(action!=='dismiss' && !confirm(action==='update'?"Update the selected saved assignment using this schedule? Personal notes and custom fields will be kept.":"Add this as a separate assignment? Check that it is not already saved."))return;
      try {
        const expected=localStorage.getItem(STORAGE_KEY),saved=JSON.parse(expected || "[]");
        const expectedQueue=localStorage.getItem(ATTENTION_KEY),queue=JSON.parse(expectedQueue || "[]");
        if(!queue.some(a=>a.id===item.id))throw new Error("This item was already handled. Reload to refresh.");
        const next=action==='dismiss'?saved:Sync.apply(saved,[{incoming:item.incoming,selected:true,action,targetId:decision.value,overrides:[]}]);
        await commitBulk(next,expected,undefined,undefined,queue.filter(a=>a.id!==item.id),expectedQueue);
        $("importMessage").textContent=action==='dismiss'?"Item dismissed. Saved assignments were not changed.":"Assignment saved. Personal notes and history were kept.";
      }catch(error){alert(`No changes applied: ${error.message}`);}
    }
    if(item.incoming) {
      if(item.candidates?.length) {article.append(decision);const update=document.createElement("button");update.type="button";update.className="secondary-btn";update.textContent="Update selected assignment";update.addEventListener("click",()=>resolve('update'));article.append(update);}
      const add=document.createElement("button");add.type="button";add.className="secondary-btn";add.textContent="Add separately";add.addEventListener("click",()=>resolve('new'));article.append(add);
    }
    const dismiss=document.createElement("button");dismiss.type="button";dismiss.className="secondary-btn";dismiss.textContent="Dismiss";dismiss.addEventListener("click",()=>resolve('dismiss'));article.append(dismiss);
    $("attentionItems").append(article);
  }
}
function issueKey(item) {return JSON.stringify(item.incoming || item.message);}
$("importBtn").addEventListener("click",async()=>{
  const button=$("importBtn");button.disabled=true;
  try {
    const name=$("nameFilter").value.trim(),aliases=settings.aliases || [],mode=$("importMode").value;
    if(mode==='mine' && !name && !aliases.length)throw new Error("Enter a photographer name or choose All Assignments.");
    const input=$("scheduleText").value.trim();if(!input)throw new Error("Paste a schedule or upload a file first.");
    const parsed=Sync.parse(input,new Date(),[name,...aliases].filter(Boolean));
    const expected=localStorage.getItem(STORAGE_KEY),saved=JSON.parse(expected || "[]");
    const result=Sync.automatic(saved,parsed.rows,{name,aliases,mode});
    const unknown=mode==='mine'?parsed.rows.filter(a=>!a.photographers?.length):[];
    const issues=[...result.attention,...unknown.map(incoming=>({incoming,candidates:[],message:'No photographer could be identified for this entry. It was not imported.'}))];
    if(parsed.warnings.length)issues.push({message:`${parsed.warnings.length} part${parsed.warnings.length===1?'':'s'} of the file could not be fully read. Use dated text entries or the documented JSON fields; no saved assignments were removed.`});
    const expectedQueue=localStorage.getItem(ATTENTION_KEY),queue=JSON.parse(expectedQueue || "[]");
    for(const issue of issues)if(!queue.some(old=>issueKey(old)===issueKey(issue)))queue.push({...issue,id:crypto.randomUUID()});
    if(result.counts.added || result.counts.updated || queue.length!==JSON.parse(expectedQueue || "[]").length)await commitBulk(result.next,expected,undefined,undefined,queue,expectedQueue);
    else {assignments=saved;loadedRaw=expected;attention=queue;renderAttention();renderAll();}
    $("importAttention").open=false;
    let explanation='';
    if(!parsed.rows.length)explanation=' No supported assignments were found. Use dated text entries or a JSON schedule; see the supported formats.';
    else if(mode==='mine' && unknown.length===parsed.rows.length)explanation=' No photographer names could be identified. Nothing was imported. Add a Photographers: name field or choose All Assignments.';
    else if(mode==='mine' && !result.counts.added && !result.counts.updated && !result.counts.unchanged && !issues.length)explanation=' No assignments matched that name or its aliases. Try the exact name used in the schedule.';
    $("importMessage").textContent=`Import complete: ${result.counts.added} added, ${result.counts.updated} updated, ${result.counts.unchanged} unchanged, ${issues.length} need attention.${explanation}`;
  }catch(error){$("importMessage").textContent=`Import stopped. Saved assignments were not changed: ${error.message}`;}
  finally{button.disabled=false;}
});

$("sampleBtn").addEventListener("click",()=>{
  const name=$("nameFilter").value.trim() || (settings.aliases || [])[0] || "Sample Photographer";
  $("scheduleText").value=`Mon, Nov 2, ${new Date().getFullYear()}
[ID: sample-1] Example HS Faculty Individuals - arrival 8:30am - start 9:00am - end 1:00pm - gym - Photographers: ${name}`;
  cancelPreview();
});

function downloadICS(a) {
  const start = a.startTime || "09:00";
  const end = a.endTime || addMinutes(start, 120);
  const dtStart = `${a.date.replaceAll("-","")}T${start.replace(":","")}00`;
  const dtEnd = `${a.date.replaceAll("-","")}T${end.replace(":","")}00`;
  const body = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//PhotoOps//EN","BEGIN:VEVENT",
    `UID:${a.id}@photoops`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape([a.school,a.assignmentType].filter(Boolean).join(" — "))}`,
    `LOCATION:${icsEscape([a.location,a.address].filter(Boolean).join(", "))}`,
    `DESCRIPTION:${icsEscape([a.arrivalTime ? "Arrival: " + a.arrivalTime : "", a.notes, a.scheduleNotes].filter(Boolean).join("\n"))}`,
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
  downloadBlob("photoops-backup.json", JSON.stringify({schemaVersion:21,assignments,settings,schools,attention}, null, 2), "application/json");
});

$("backupInput").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if(!Array.isArray(data.assignments) || data.assignments.some(a=>!a || typeof a.id!=="string" || !Sync.validDate(a.date) || typeof a.school!=="string" || !a.school.trim())) throw new Error("Invalid backup");
    if(!confirm("Merge this backup into your assignments? Existing records are kept, and a safety backup is saved first.")) return;
    if(data.schools!==undefined && !Array.isArray(data.schools))throw new Error("Invalid school directory in backup");
    const expectedSchools=localStorage.getItem(SCHOOLS_KEY);
    const directoryMerge=Planner.mergeSchools(JSON.parse(expectedSchools || "[]"),data.schools || []);
    const expectedAttention=localStorage.getItem(ATTENTION_KEY);
    const mergedAttention=JSON.parse(expectedAttention || "[]");
    if(data.attention!==undefined) {
      if(!Array.isArray(data.attention) || data.attention.some(a=>!a || typeof a.id!=="string" || typeof a.message!=="string" || (a.incoming && (typeof a.incoming.school!=="string" || !Sync.validDate(a.incoming.date)))))throw new Error("Invalid saved attention items in backup");
      for(const issue of data.attention)if(!mergedAttention.some(a=>a.id===issue.id || issueKey(a)===issueKey(issue)))mergedAttention.push(issue);
    }
    const expected=localStorage.getItem(STORAGE_KEY);
    const current=JSON.parse(expected || "[]");
    // Preserve current records on ID conflicts; restoration of an individual version is explicit.
    const merged=[...current,...data.assignments.filter(a=>!current.some(old=>old.id===a.id)).map(a=>directoryMerge.idMap[a.schoolId]?{...a,schoolId:directoryMerge.idMap[a.schoolId]}:a)];
    await commitBulk(merged,expected,data.schools===undefined?undefined:directoryMerge.schools,expectedSchools,data.attention===undefined?undefined:mergedAttention,expectedAttention);
    cancelPreview();
    alert("Backup merged. Existing assignments, schools, and settings were preserved.");
  } catch(error) {
    alert(`Backup import stopped: ${error.message}`);
  }
});

$("clearBtn").addEventListener("click", () => {
  if (confirm("Clear every saved assignment?")) {
    try { saveAssignments([]); cancelPreview(); } catch(error) { alert(`Clear stopped: ${error.message}`); }
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

renderSchools();
renderAttention();
renderAll();
