/* A recovery journal is used only when restoring multiple local storage keys. */
(function(root) {
  const JOURNAL='PhotoOpsPreviewRestoreJournalV21';
  function restoreRaw(storage,key,value) {if(value===null)storage.removeItem(key);else storage.setItem(key,value);}
  function recover(storage) {
    const raw=storage.getItem(JOURNAL);if(!raw)return;
    const journal=JSON.parse(raw);
    if(!journal || !Array.isArray(journal.before) || journal.before.some(([k,v])=>!['PhotoOpsPreviewAssignmentsV1','PhotoOpsPreviewSchoolsV1'].includes(k) || (v!==null && typeof v!=='string')))throw new Error('Invalid restore journal. Export local data before continuing.');
    for(const [key,value] of journal.before)restoreRaw(storage,key,value);
    storage.removeItem(JOURNAL);
  }
  function transaction(storage,expected,writes) {
    if(storage.getItem(JOURNAL))throw new Error('A previous restore needs recovery. Reload before saving.');
    for(const [key,value] of Object.entries(expected))if(storage.getItem(key)!==value)throw new Error('Saved data changed in another tab. Reload or preview again.');
    const entries=Object.entries(writes);if(!entries.length)return;
    if(entries.length===1){storage.setItem(...entries[0]);return;}
    const before=entries.map(([key])=>[key,storage.getItem(key)]);
    storage.setItem(JOURNAL,JSON.stringify({before}));
    try {
      for(const [key,value] of entries)storage.setItem(key,value);
      storage.removeItem(JOURNAL);
    } catch(error) {
      // If rollback is interrupted, the journal remains for startup recovery.
      for(const [key,value] of before)restoreRaw(storage,key,value);
      storage.removeItem(JOURNAL);throw error;
    }
  }
  const api={JOURNAL,recover,transaction};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.PhotoOpsStore=api;
})(globalThis);
