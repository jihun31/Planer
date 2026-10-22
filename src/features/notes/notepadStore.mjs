export const MAX_NOTE_LENGTH = 50000;
export const noteDraftKey = (uid,noteId = 'legacy') => `planer:notepad-draft:${uid}${noteId === 'legacy' ? '' : `:${noteId}`}`;
const validText = text => typeof text === 'string' && text.length <= MAX_NOTE_LENGTH;

// One serial save queue per editor. Local drafts survive closing the app; revision
// checks stop another window's edits from being overwritten silently.
export function createNotepadStore({ uid, subscribe, save, storage, delay = 1200, noteId = 'legacy' }) {
  const key = noteDraftKey(uid,noteId);
  let draft = null, localError = false;
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    if (value && validText(value.text) && (value.revision === null || Number.isInteger(value.revision))) draft = value;
  } catch { localError = true; }
  let revision = draft?.revision ?? null, remoteText = '', ready = false, blocked = false;
  let timer, unsubscribe, disposed = true, subscription = 0, buffered = null;
  let state = {text:draft?.text ?? '',dirty:!!draft,loading:true,saving:false,deleting:false,deleted:false,error:null,conflict:null,localError};
  const listeners = new Set();
  const update = patch => {
    state = {...state,...patch};
    for (const listener of listeners) listener();
  };
  const persist = () => {
    try {
      if (state.dirty) storage.setItem(key,JSON.stringify({text:state.text,revision}));
      else storage.removeItem(key);
      if (state.localError) update({localError:false});
    } catch { if (!state.localError) update({localError:true}); }
  };
  const schedule = () => {
    clearTimeout(timer);
    if (ready && state.dirty && !state.saving && !state.deleting && !state.deleted && !state.conflict && !blocked && !disposed)
      timer = setTimeout(flush,delay);
  };
  const receive = remote => {
    if (disposed || state.deleting || state.deleted) return;
    if (remote.deleted) {
      clearTimeout(timer);blocked = true;
      update({text:'',dirty:false,loading:false,saving:false,deleted:true,conflict:null,error:null});persist();return;
    }
    if (state.saving) { buffered = remote; return; }
    if (ready && revision !== null && remote.revision < revision) return;
    ready = true;
    if (!state.dirty || remote.text === state.text) {
      revision = remote.revision; remoteText = remote.text;
      update({text:remote.text,dirty:false,loading:false,error:null,conflict:null});
      persist();
    } else if (remote.revision === revision || (revision === null && remote.revision === 0 && remote.text === '')) {
      revision = remote.revision; remoteText = remote.text;
      update({loading:false}); persist(); schedule();
    } else {
      update({loading:false,conflict:remote,error:null});
      clearTimeout(timer);
    }
  };
  async function flush() {
    clearTimeout(timer);
    if (!ready || !state.dirty || state.saving || state.deleting || state.deleted || state.conflict || blocked || disposed) return;
    const text = state.text, expectedRevision = revision;
    update({saving:true,error:null});
    try {
      const savedRevision = await save(uid,text,expectedRevision);
      if (disposed || state.deleting || state.deleted) return;
      revision = savedRevision; remoteText = text;
      update({saving:false,dirty:state.text !== text});
      persist();
    } catch (error) {
      if (disposed || state.deleting || state.deleted) return;
      if (error.code === 'notepad/deleted') {receive({deleted:true});return;}
      if (error.code === 'notepad/conflict') update({saving:false,conflict:error.remote,error:null});
      else { blocked = true; update({saving:false,error}); }
    } finally {
      if (!disposed && !state.deleting && !state.deleted) {
        const remote = buffered; buffered = null;
        if (remote) receive(remote);
        schedule();
      }
    }
  }
  const connect = () => {
    unsubscribe?.();
    const current = ++subscription;
    try {
      unsubscribe = subscribe(uid, remote => {
        if (current === subscription) receive(remote);
      }, error => {
        if (disposed || current !== subscription) return;
        blocked = true; clearTimeout(timer); update({loading:false,error});
      });
    } catch (error) { blocked = true; update({loading:false,error}); }
  };
  return {
    getSnapshot:() => state,
    subscribe:listener => { listeners.add(listener); return () => listeners.delete(listener); },
    start() {
      disposed = false; connect();
      return () => { disposed = true; subscription++; unsubscribe?.(); clearTimeout(timer); };
    },
    edit(text) {
      if (!validText(text) || state.deleting || state.deleted) return;
      update({text,dirty:text !== remoteText || state.saving || !!state.conflict});
      persist(); schedule();
    },
    retry() { if (!state.deleted && !state.deleting) {blocked = false; update({error:null}); connect(); schedule();} },
    async remove(removeRemote) {
      if (state.deleting || state.deleted) return;
      const wasBlocked = blocked;
      clearTimeout(timer);blocked = true;buffered = null;update({deleting:true});
      try {
        await removeRemote();
        update({text:'',dirty:false,deleting:false,deleted:true,saving:false,conflict:null,error:null});persist();
      } catch (error) {
        blocked = wasBlocked;update({deleting:false,saving:false});connect();schedule();throw error;
      }
    },
    resolveConflict(useLocal) {
      if (!state.conflict || state.saving) return;
      const remote = state.conflict;
      revision = remote.revision; remoteText = remote.text; blocked = false;
      update({conflict:null,error:null,...(useLocal ? {dirty:state.text !== remote.text} : {text:remote.text,dirty:false})});
      persist();
      if (useLocal) return flush();
    },
    flush,
  };
}
