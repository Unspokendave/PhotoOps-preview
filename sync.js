/* Pure schedule parsing, matching and restoration; no network or storage access. */
(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const fields = ['date','arrivalTime','startTime','endTime','school','location','assignmentType','photographers','address','status','scheduleNotes','scheduleDetails'];
  const equal = (a,b) => (!present(a) && !present(b)) || JSON.stringify(Array.isArray(a) ? a.map(norm).sort() : norm(a)) === JSON.stringify(Array.isArray(b) ? b.map(norm).sort() : norm(b));
  const present = value => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && String(value).trim() !== '';
  function category(title) {
    const split = title.match(/^(.*?)\s*\|\s*(.+)$/);
    if (split) return {school:split[1].trim(), assignmentType:split[2].trim()};
    for (const [re, type] of [[/\b(?:SR\d*\s+MU|Senior Make-?ups?)\b/i,'Senior Makeups'],[/\bSenior Sports\b/i,'Senior Sports'],[/\bFaculty Individuals?\b/i,'Faculty Individuals'],[/\bFaculty Groups?\b/i,'Faculty Groups'],[/\b(?:Fall |Winter |Spring )?Sportsmates\b/i,'Sportsmates']]) {
      const m=title.match(re); if(m) return {school:title.slice(0,m.index).trim() || title,assignmentType:type};
    }
    return {school:title.trim()};
  }
  function nameKey(value) {
    let text=norm(value).normalize('NFKC').replace(/[’]/g,"'").replace(/\./g,'');
    const parts=text.split(',').map(s=>s.trim());
    if(parts.length===2 && parts.every(Boolean))text=parts[1]+' '+parts[0];
    return text.replace(/\s+/g,' ');
  }
  function nameMatch(a,b) {return !!nameKey(a) && nameKey(a)===nameKey(b);}
  function person(value) {
    return /^[\p{L}][\p{L}’'.-]*(?:\s+[\p{L}][\p{L}’'.-]*){0,3}$/u.test(value) && !/\b(?:gym|school|hs|ms|es|address|location|pending|approval|notes|unknown|tbd|unassigned|cafeteria|auditorium|training|sportsmates|faculty|groups|individuals|senior|makeups|background|bkgd|confirmed|cancelled|canceled|stadium|field|stage)\b/i.test(value);
  }
  function entryParts(text,knownNames=[]) {
    const parts=text.split(/\n|\s+-\s*/).map(s=>s.trim()).filter(Boolean);
    let names=[];const consumed=new Set();
    function read(value) {
      value=value.replace(/\((?:training|confirmed|tentative|tbd)\)/ig,'').trim();
      if(knownNames.some(n=>nameMatch(n,value)) && (person(value) || (value.split(',').length===2 && value.split(',').every(n=>person(n.trim())))))return [value];
      const list=value.split(/\s*(?:,|;|&|\band\b)\s*/i).filter(Boolean);
      if(list.length===2 && /^[A-Z]{2}$/.test(list[1]))return []; // An unlabelled city/state is not a person list.
      return list.length && list.every(person)?list:[];
    }
    parts.forEach((part,index)=>{
      const labeled=part.match(/\b(?:photographers?|staff|assigned to)\s*:\s*(.*?)(?=\s+(?:location|address|arrival|start|end|notes)\s*:|$)/i);
      if(labeled) {const found=read(labeled[1]);names.push(...found);if(labeled.index===0)consumed.add(index);return;}
      const structural=index===parts.length-1 || (index===0 && parts.length>1 && (category(parts[1]).assignmentType || /\b(?:HS|MS|ES|school|academy)\b/i.test(parts[1])));
      if(structural || knownNames.some(n=>read(part).some(m=>nameMatch(n,m)))) {
        const found=read(part);
        if(found.length && (parts.length>1 || knownNames.some(n=>nameMatch(n,part)))) {names.push(...found);consumed.add(index);}
      }
    });
    return {title:parts.find((part,i)=>!consumed.has(i) && !/^(?:(?:arrival|arrive|start|end|location|address|notes|id)\s*[:@]|\d{1,2}:\d{2}|(?:gym|cafeteria|auditorium|stadium|field)$)/i.test(part)) || '',photographers:[...new Map(names.map(n=>[nameKey(n),n])).values()]};
  }
  function roster(text) {return entryParts(text).photographers;}
  function time(value) {
    const m=String(value).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
    if(!m) return undefined;
    let h=+m[1]; const min=+m[2];
    if(min>59 || (m[3] ? h<1 || h>12 : h>23)) return undefined;
    if(m[3]) h=h%12+(norm(m[3])==='pm'?12:0);
    return `${String(h).padStart(2,'0')}:${m[2]}`;
  }
  function validDate(date) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
    const d=new Date(date+'T12:00:00'); return !Number.isNaN(+d) && [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')===date;
  }
  function parse(text, now=new Date(), knownNames=[]) {
    const warnings=[]; let rows=[];
    if (/^[\s]*[\[{]/.test(text)) {
      const data=JSON.parse(text); const list=Array.isArray(data)?data:data.assignments;
      if(!Array.isArray(list)) throw new Error('JSON must contain an assignments array.');
      rows=list.map(a=>{
        if(!a || typeof a!=='object' || Array.isArray(a)) return {};
        const out={...category(String(a.school || '')),date:a.date};
        for(const f of fields) if(present(a[f])) out[f]=clone(a[f]);
        if(typeof out.photographers==='string')out.photographers=entryParts('Photographers: '+out.photographers,knownNames).photographers;
        if(!out.photographers && typeof a.photographer==='string')out.photographers=entryParts('Photographers: '+a.photographer,knownNames).photographers;
        out.sourceId=String(a.sourceId || a.assignmentId || a.jobId || a.id || '').trim();
        if(present(a.notes) && !out.scheduleNotes) out.scheduleNotes=a.notes;
        const extras=Object.fromEntries(Object.entries(a).filter(([k])=>![...fields,'id','sourceId','assignmentId','jobId','notes','sync','history','manualFields'].includes(k)));
        if(Object.keys(extras).length) out.scheduleDetails=JSON.stringify(extras,null,2);
        out.school=category(String(a.school || '')).school;
        return out;
      });
    } else {
      const blocks=[]; let date, block='';
      const flush=()=>{if(block && date) blocks.push({date,text:block});block='';};
      for(const line of text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean)) {
        const m=line.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i);
        if(m) {
          flush(); const month=new Date(`${m[1]} 1, 2000`).getMonth(); let year=+m[3] || now.getFullYear();
          if(!m[3] && new Date(year,month,1)<new Date(now.getFullYear(),now.getMonth()-3,1)) year++;
          date=`${year}-${String(month+1).padStart(2,'0')}-${m[2].padStart(2,'0')}`;
          if(!validDate(date)) {warnings.push(`Invalid date header: ${line}`); date=null;}
        } else if(date) {
          const title=line.split(/\s+-\s*/)[0];
          if(block && entryParts(block,knownNames).title && (/^(?:\*\*C\*\*|C\s)/.test(line) || (/\s+-\s*/.test(line) && (category(title).assignmentType || /\d{1,2}:\d{2}\s*(am|pm)/i.test(line))))) flush();
          block+=(block?'\n':'')+line;
        } else warnings.push(`Unparsed text: ${line}`);
      }
      flush();
      rows=blocks.map(({date,text})=>{
        const sourceId=text.match(/\b(?:assignment\s*id|job\s*id|id)\s*:\s*([\w.-]+)/i)?.[1];
        const clean=text.replace(/\[(?:assignment\s*id|job\s*id|id)\s*:\s*[\w.-]+\]/ig,'').replace(/\*\*/g,'').replace(/^C[ \t]+/gm,'').trim();
        const parsed=entryParts(clean,knownNames);
        const result={...category(parsed.title),date,sourceId,photographers:parsed.photographers,scheduleNotes:clean};
        const labeled=(label)=>clean.match(new RegExp('\\b(?:'+label+')\\s*[:@]?\\s*(\\d{1,2}:\\d{2}\\s*(?:am|pm)?)','i'));
        for(const [field,label] of [['arrivalTime','arrival|arrive|report'],['startTime','start'],['endTime','end|last appt']]) {
          const m=labeled(label); if(m) result[field]=time(m[1]);
        }
        const unlabeled=clean.replace(/\b(?:arrival|arrive|report|start|end|last appt)\s*[:@]?\s*\d{1,2}:\d{2}\s*(?:am|pm)?/ig,'');
        const times=[...unlabeled.matchAll(/\d{1,2}:\d{2}\s*(?:am|pm)/ig)].map(m=>time(m[0]));
        if(!result.startTime && times[0]) result.startTime=times[0];
        if(!result.endTime && times[1]) result.endTime=times[1];
        result.address=clean.match(/\bAddress:\s*(.*?)(?:\)|\s+-\s+|$)/i)?.[1]?.trim();
        result.location=clean.match(/\bLocation:\s*(.*?)(?:\)|\s+-\s+|$)/i)?.[1]?.trim() || clean.match(/-\s*(Outside & gym|gym foyer|Main Gym|Aux gym|Auditorium|Aud|gym|cafeteria|stage|stadium|field|playground)\b/i)?.[1];
        result.status=/pending/i.test(clean)?'tentative':/time tbd|loc tbd/i.test(clean)?'tbd':/training/i.test(clean)?'training':/confirmed/i.test(clean)?'confirmed':undefined;
        return result;
      });
    }
    const accepted=[];
    rows.forEach((a,i)=>{
      if(!validDate(a.date) || typeof a.school!=='string' || !a.school.trim() || (a.photographers!==undefined && (!Array.isArray(a.photographers) || !a.photographers.every(n=>typeof n==='string')))) {warnings.push(`Row ${i+1}: invalid school, date or photographer roster; not imported.`);return;}
      for(const field of fields) {
        if(!present(a[field])) delete a[field];
        else if(field.endsWith('Time')) {const t=time(a[field]);if(t) a[field]=t;else {warnings.push(`Row ${i+1}: invalid ${field}; not imported.`);delete a[field];}}
        else if(field!=='photographers' && typeof a[field]!=='string') {warnings.push(`Row ${i+1}: invalid ${field}; not imported.`); delete a[field];}
      }
      if(a.status) {
        const status=norm(a.status);
        if(['confirmed','training','tentative','tbd'].includes(status)) a.status=status;
        else { warnings.push(`Row ${i+1}: unrecognized status retained in imported details, not applied as a status.`); a.scheduleDetails=[a.scheduleDetails,`Source status: ${a.status}`].filter(Boolean).join('\n'); delete a.status; }
      }
      accepted.push(a);
    });
    return {rows:accepted,warnings};
  }
  function info(a) {
    return {...category(a.school||''),...a,assignmentType:a.assignmentType || category(a.school||'').assignmentType,photographers:a.photographers || roster(a.scheduleNotes || a.notes || '')};
  }
  function comparable(a) {const result={};for(const f of fields) if(present(a[f])) result[f]=a[f];return result;}
  function fingerprint(a) {return JSON.stringify([a.sourceId || '',...fields.map(f=>Array.isArray(a[f]) ? a[f].map(norm).sort() : norm(a[f]))]);}
  function overlap(a,b) {return (a||[]).some(n=>(b||[]).some(m=>nameMatch(m,n)));}
  function changes(old, incoming, overrides=[]) {
    const result=[]; const source=old.sync?.source;
    for(const f of fields) {
      if(!present(incoming[f])) continue; // Absence is never a request to clear a field.
      const baseline=source && present(source[f]) ? source[f] : info(old)[f];
      const protectedField=(old.manualFields || []).includes(f) || (source && present(source[f]) && present(old[f]) && !equal(old[f],source[f])) || ((!source || !present(source[f])) && ['address'].includes(f) && present(old[f]));
      if(!equal(baseline,incoming[f]) || (overrides.includes(f) && !equal(old[f],incoming[f]))) result.push({field:f,before:old[f] ?? info(old)[f] ?? '',incoming:incoming[f],preserved:!!protectedField && !overrides.includes(f)});
    }
    if (incoming.sourceId && incoming.sourceId !== (old.sync?.sourceId || old.sourceId)) result.push({field:'sourceId',before:old.sync?.sourceId || old.sourceId || '',incoming:incoming.sourceId,preserved:false});
    return result;
  }
  function match(existing, incoming) {
    const id=incoming.sourceId;
    if(id) {
      const exact=existing.filter(a=>a.sync?.sourceId===id || a.sourceId===id);
      if(exact.length) return {candidates:exact,confident:exact.length===1,reason:'Explicit source assignment ID'};
    }
    const candidates=existing.filter(a=>{
      const old={...info(a),...(a.sync?.source || {})};
      if(id && (a.sync?.sourceId || a.sourceId) && (a.sync?.sourceId || a.sourceId)!==id) return false;
      const school=norm(category(old.school).school)===norm(incoming.school);
      const type=present(old.assignmentType) && equal(old.assignmentType,incoming.assignmentType);
      const people=overlap(old.photographers,incoming.photographers);
      return school || (type && old.date===incoming.date && people);
    });
    const exact=candidates.filter(a=>a.sync?.source && fields.every(f=>!present(incoming[f]) || equal(a.sync.source[f],incoming[f])));
    if(exact.length===1) return {candidates:exact,confident:true,reason:'Unchanged source record'};
    const confident=candidates.filter(a=>{
      const old={...info(a),...(a.sync?.source || {})};
      return norm(category(old.school).school)===norm(incoming.school) && equal(old.assignmentType,incoming.assignmentType) && old.date===incoming.date && (overlap(old.photographers,incoming.photographers) || (present(old.startTime) && old.startTime===incoming.startTime));
    });
    // A changed date without a stable ID is reviewed, even with a unique likely match.
    return {candidates:confident.length===1?confident:candidates,confident:confident.length===1,reason:candidates.length?'Possible match; verify identity, especially reschedules or recurring work':'No existing match'};
  }
  function plan(existing, rows, preferences={}) {
    const entries=[];const seen=new Set();let duplicates=0;
    const names=[preferences.name,...(preferences.aliases || [])].filter(present);
    for(const incoming of rows) {
      const fp=fingerprint(incoming);if(seen.has(fp)){duplicates++;continue;}seen.add(fp);
      const found=match(existing,incoming);
      const mine=(incoming.photographers||[]).some(n=>names.some(m=>nameMatch(n,m)));
      if(preferences.mode==='mine' && !mine) continue;
      const old=found.confident?found.candidates[0]:null;
      const diffs=old?changes(old,incoming):[];
      const status=old?(diffs.length?'updated':'unchanged'):found.candidates.length?'ambiguous':'new';
      entries.push({incoming:clone(incoming),status,candidates:found.candidates.map(a=>a.id),targetId:old?.id,diffs,reason:found.reason,selected:preferences.mode!=='review' && status!=='ambiguous' && status!=='unchanged',action:old?'update':found.candidates.length?'skip':'new',overrides:[]});
    }
    for(const entry of entries) {
      const collision=entries.filter(other=>other!==entry && ((entry.targetId && other.targetId===entry.targetId) || (entry.incoming.sourceId && other.incoming.sourceId===entry.incoming.sourceId) || (!entry.targetId && !other.targetId && !(entry.incoming.sourceId && other.incoming.sourceId && entry.incoming.sourceId!==other.incoming.sourceId) && equal(entry.incoming.school,other.incoming.school) && equal(entry.incoming.assignmentType,other.incoming.assignmentType) && entry.incoming.date===other.incoming.date && equal(entry.incoming.startTime,other.incoming.startTime))));
      if(collision.length) {entry.status='ambiguous';entry.selected=false;entry.action='skip';entry.reason='Conflicting rows reference the same assignment; select only one or keep separate.';}
    }
    return {entries,duplicates};
  }
  function apply(existing, entries, now=new Date().toISOString()) {
    const next=clone(existing);const targets=new Set();
    for(const entry of entries.filter(e=>e.selected && e.action!=='skip')) {
      if(entry.action==='new') {
        if(next.some(a=>entry.incoming.sourceId && (a.sync?.sourceId || a.sourceId)===entry.incoming.sourceId)) throw new Error('Duplicate source ID. Link to the existing assignment instead.');
        next.push({...clone(entry.incoming),id:root.crypto.randomUUID(),notes:'',status:entry.incoming.status||'confirmed',sync:{sourceId:entry.incoming.sourceId,source:comparable(entry.incoming),lastImportedAt:now},history:[]});
      } else {
        if(targets.has(entry.targetId)) throw new Error('Two imported rows target the same assignment. Resolve them before syncing.');targets.add(entry.targetId);
        const index=next.findIndex(a=>a.id===entry.targetId);if(index<0) throw new Error('The matched assignment no longer exists. Preview again.');
        const old=next[index];
        if(entry.incoming.sourceId && next.some(a=>a.id!==old.id && (a.sync?.sourceId || a.sourceId)===entry.incoming.sourceId)) throw new Error('That source ID already belongs to a different assignment.');
        const diffs=changes(old,entry.incoming,entry.overrides);
        if(!diffs.length && old.sync) continue;
        const updated=clone(old);for(const d of diffs) if(!d.preserved) updated[d.field]=clone(d.incoming);
        const previous=clone(old);delete previous.history;
        updated.history=[...(old.history||[]),{at:now,kind:'sync',previous}];
        updated.sync={...(old.sync||{}),sourceId:entry.incoming.sourceId || old.sync?.sourceId,source:{...(old.sync?.source||{}),...comparable(entry.incoming)},lastImportedAt:now};
        // Explicitly accepting an imported value releases that manual override.
        updated.manualFields=(old.manualFields||[]).filter(f=>!entry.overrides.includes(f));
        next[index]=updated;
      }
    }
    return clone(next);
  }
  function automatic(existing,rows,preferences={},now=new Date().toISOString()) {
    const proposed=plan(existing,rows,{...preferences,mode:preferences.mode==='all'?'all':'mine'});
    const counts={added:0,updated:0,unchanged:0,attention:0};const attention=[];
    for(const entry of proposed.entries) {
      if(entry.status==='ambiguous') {attention.push({incoming:entry.incoming,candidates:entry.candidates,message:'This may be an existing or rescheduled assignment. Saved work was left unchanged.'});counts.attention++;}
      else if(entry.status==='new')counts.added++;
      else if(entry.status==='updated')counts.updated++;
      else counts.unchanged++;
    }
    return {next:apply(existing,proposed.entries,now),counts,attention,duplicates:proposed.duplicates};
  }
  function restore(a,index,now=new Date().toISOString()) {
    const event=a.history?.[index];if(!event?.previous) throw new Error('No prior values to restore.');
    const previous=clone(a);delete previous.history;
    return {...clone(event.previous),id:a.id,history:[...clone(a.history),{at:now,kind:'restore',previous}]};
  }
  function inView(a,view,anchor) {
    if(view==='all') return true;
    const date=new Date(a.date+'T12:00:00');const start=new Date(anchor+'T12:00:00');
    if(view==='day') return a.date===anchor;
    if(view==='month') return a.date.slice(0,7)===anchor.slice(0,7);
    start.setDate(start.getDate()-((start.getDay()+6)%7));const end=new Date(start);end.setDate(end.getDate()+7);
    return date>=start && date<end;
  }
  const api={fields,norm,equal,category,roster,parse,info,changes,match,plan,apply,restore,inView,clone,validDate,nameKey,nameMatch,entryParts,automatic};
  if(typeof module!=='undefined' && module.exports) module.exports=api;else root.PhotoOpsSync=api;
})(globalThis);
