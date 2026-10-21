/* Local calendar, filters and school-directory rules. No browser dependencies. */
(function(root) {
  const norm = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  const date = value => new Date(value+'T12:00:00');
  function iso(d) {return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function addDays(value,days) {const d=date(value);d.setDate(d.getDate()+days);return iso(d);}
  function monday(value) {const d=date(value);d.setDate(d.getDate()-(d.getDay()+6)%7);return iso(d);}
  function navigate(value,view,direction) {
    if(view==='month') {const d=date(value),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+direction);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return iso(d);}
    return addDays(value,direction*(view==='week'?7:1));
  }
  function days(value,view) {
    const start=view==='month'?monday(value.slice(0,7)+'-01'):view==='week'?monday(value):value;
    return Array.from({length:view==='month'?42:view==='week'?7:1},(_,i)=>addDays(start,i));
  }
  function inView(a,view,anchor) {
    if(view==='all')return true;
    if(view==='day')return a.date===anchor;
    if(view==='month')return a.date.slice(0,7)===anchor.slice(0,7);
    const start=monday(anchor);return a.date>=start && a.date<addDays(start,7);
  }
  function filter(assignments,options={}) {
    const {school='',start='',end='',type='',status='all',search='',view='all',anchor=iso(new Date())}=options;
    return assignments.filter(a=>(!school || norm(a.school)===norm(school)) && (!start || a.date>=start) && (!end || a.date<=end) && (!type || norm(a.assignmentType)===norm(type)) && (status==='all' || a.status===status) && inView(a,view,anchor) && norm([a.school,a.location,a.address,a.contacts,a.notes,a.scheduleNotes,a.scheduleDetails,a.assignmentType,...(a.photographers||[])].join(' ')).includes(norm(search)))
      .sort((a,b)=>a.date.localeCompare(b.date) || (a.startTime || a.arrivalTime || '24:00').localeCompare(b.startTime || b.arrivalTime || '24:00') || String(a.school).localeCompare(String(b.school)));
  }
  function schoolKey(s) {return [s.name,s.city,s.state].map(norm).join('|');}
  function validSchool(s) {return s && typeof s.id==='string' && s.id.trim() && ['name','address','city','state','zip'].every(k=>typeof s[k]==='string' && s[k].trim()) && ['phone','notes'].every(k=>s[k]===undefined || typeof s[k]==='string');}
  function saveSchool(schools,school) {
    if(!validSchool(school))throw new Error('Enter a school name, street address, city, state/region, and ZIP/postal code.');
    if(schools.some(s=>s.id!==school.id && schoolKey(s)===schoolKey(school)))throw new Error('A school with this name, city and state already exists. Edit that school or use a distinct campus name.');
    return schools.some(s=>s.id===school.id)?schools.map(s=>s.id===school.id?{...s,...school}:s):[...schools,school];
  }
  function schoolAddress(s) {return [s.address,[s.city,s.state,s.zip].filter(Boolean).join(', ')].filter(Boolean).join(', ');}
  function searchSchools(schools,term) {return schools.filter(s=>norm([s.name,s.address,s.city,s.state,s.zip,s.phone,s.notes].join(' ')).includes(norm(term))).sort((a,b)=>a.name.localeCompare(b.name)||a.city.localeCompare(b.city));}
  function mergeSchools(current,incoming=[]) {
    const schools=current.map(s=>({...s})),idMap=Object.create(null);
    for(const school of incoming) {
      if(!validSchool(school))throw new Error('Invalid school in backup. No data was restored.');
      const found=schools.find(s=>s.id===school.id || schoolKey(s)===schoolKey(school));
      if(found)idMap[school.id]=found.id;else {schools.push({...school});idMap[school.id]=school.id;}
    }
    return {schools,idMap};
  }
  const api={norm,iso,addDays,monday,navigate,days,inView,filter,schoolKey,validSchool,saveSchool,schoolAddress,searchSchools,mergeSchools};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.PhotoOpsPlanner=api;
})(globalThis);
