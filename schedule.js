// Shared import and directory logic. No storage writes or browser dependencies.
(function(root) {
  const key = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const categories = [
    [/\b(?:SR\d*\s+MU|Senior\s+(?:Makeups?|Make-ups?))\b/i, 'Senior Makeups'],
    [/\bSenior Sports\b/i, 'Senior Sports'],
    [/\bFaculty Individuals?\b/i, 'Faculty Individuals'],
    [/\bFaculty Groups?\b/i, 'Faculty Groups'],
    [/\b(?:Fall |Spring |Winter )?Sportsmates\b/i, 'Sportsmates']
  ];
  function classify(title) {
    const explicit = title.match(/^(.*?)\s*\|\s*(.+)$/);
    if (explicit) return {school:explicit[1].trim(), assignmentType:explicit[2].trim()};
    for (const [pattern, type] of categories) {
      const match = title.match(pattern);
      if (match) return {school:title.slice(0, match.index).trim() || title, assignmentType:type};
    }
    // An explicit type separator preserves unfamiliar categories without guessing.
    const suffix = title.match(/^(.*?\b(?:HS|MS|ES))\s+(.+)$/i);
    if (suffix) return {school:suffix[1].trim(), assignmentType:suffix[2].trim()};
    return {school:title, assignmentType:'Uncategorized'};
  }
  function roster(text) {
    const explicit = text.match(/(?:photographers?|staff)\s*:\s*(.+)$/i);
    const tail = explicit ? explicit[1] : text.split(/\s+-\s+/).at(-1);
    if (!explicit && !tail.includes(',')) return [];
    const names = tail.replace(/\((?:training|confirmed|tentative|tbd)\)/ig,'').trim().split(/\s*[,;]\s*/);
    // Only accept a complete roster segment, never isolated capitalized words.
    const valid = name => /^[\p{L}][\p{L}'’.\-]*(?:\s+[\p{L}][\p{L}'’.\-]*){0,3}$/u.test(name) && !/\b(?:pending|approval|gym|cafeteria|auditorium|address|school|background|bkgd|tbd|unknown|unassigned|training|notes)\b/i.test(name);
    return names.length && names.every(valid) ? [...new Map(names.map(n=>[key(n),n])).values()] : [];
  }
  function time24(time, suffix) {
    let [h,m] = time.split(':').map(Number);
    if (h < 1 || h > 12 || m > 59) return '';
    h = h % 12 + (suffix.toLowerCase()==='pm' ? 12 : 0);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  function parse(text, now = new Date()) {
    const datePattern = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i;
    const blocks=[]; let date=null, block='';
    const flush=()=>{if(date && block) blocks.push({date, text:block}); block='';};
    for (const line of text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean)) {
      const match=line.match(datePattern);
      if(match) {
        flush(); const month=new Date(`${match[1]} 1, 2000`).getMonth();
        let year=Number(match[3]) || now.getFullYear();
        if(!match[3] && new Date(year,month,1)<new Date(now.getFullYear(),now.getMonth()-3,1)) year++;
        const day=Number(match[2]); const candidate=new Date(year,month,day);
        date=Number.isNaN(month)||candidate.getMonth()!==month ? null : `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      } else if(date) {
        // A marker or a new title followed by a time starts another assignment.
        const typedTitle = /\s+-\s*/.test(line) && classify(line.split(/\s+-\s*/)[0]).assignmentType !== 'Uncategorized';
        if (/^(?:\*\*C\*\*|C\s)/.test(line) || (block && (typedTitle || /^.+\s+-\s*\d{1,2}:\d{2}\s*(?:am|pm)/i.test(line)))) flush();
        block += (block?' ':'') + line;
      }
    }
    flush();
    return merge([], blocks.map(({date,text})=>{
      const cleaned=text.replace(/\*\*/g,'').replace(/^C\s+/,'').trim();
      const title=cleaned.split(/\s+-\s*/)[0].trim();
      const times=[...cleaned.matchAll(/(\d{1,2}:\d{2})\s*(am|pm)/ig)].map(m=>time24(m[1],m[2]));
      const photographers=roster(cleaned);
      const location=cleaned.match(/-\s*(Outside & gym|gym foyer|Main Gym|Aux gym|Auditorium|Aud|gym|cafeteria|stage|stadium|field|playground)\b/i)?.[1] || '';
      const address=cleaned.match(/Address:\s*([^)]*)/i)?.[1]?.trim() || '';
      return {id:globalThis.crypto.randomUUID(),date,...classify(title),startTime:times[0]||'',endTime:times[1]||'',location,address,photographers,notes:cleaned,sourceTexts:[text],status:/pending/i.test(cleaned)?'tentative':/time tbd|loc tbd/i.test(cleaned)?'tbd':/training/i.test(cleaned)?'training':'confirmed'};
    }));
  }
  function identity(a) {
    const title=classify(a.school || '');
    return [a.date,key(title.school),key(a.assignmentType || title.assignmentType),a.startTime||'',a.endTime||'',key(a.location),key(a.address)].join('|');
  }
  function merge(existing, incoming) {
    const result=existing.map(a=>({...a}));
    for(const a of incoming) {
      const found=result.find(b=>identity(a)===identity(b));
      if(!found) result.push({...a});
      else {
        if (a.photographers?.length) found.photographers=[...new Map([...(found.photographers||[]),...a.photographers].map(n=>[key(n),n])).values()];
        const sources=[...new Set([...(found.sourceTexts||[found.notes].filter(Boolean)),...(a.sourceTexts||[a.notes].filter(Boolean))])];
        if (sources.length > 1 || found.sourceTexts) found.sourceTexts=sources;
      }
    }
    return result;
  }
  function metadata(a) {
    return {...a, assignmentType:a.assignmentType || classify(a.school||'').assignmentType, photographers:Array.isArray(a.photographers)?a.photographers:roster(a.notes||'')};
  }
  function directory(assignments, personalName='David Denk', search='', type='all') {
    const people=new Map();
    for(const a of merge([],assignments.map(metadata))) {
      if(type!=='all' && a.assignmentType!==type) continue;
      for(const name of a.photographers) {
        if(key(name)===key(personalName) || key(name)==='david denk' || !key(name).includes(key(search))) continue;
        if(!people.has(key(name))) people.set(key(name),{name,assignments:[]});
        people.get(key(name)).assignments.push(a);
      }
    }
    return [...people.values()].sort((a,b)=>a.name.localeCompare(b.name));
  }
  const api={key,classify,roster,parse,merge,identity,metadata,directory};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.PhotoOpsSchedule=api;
})(globalThis);
