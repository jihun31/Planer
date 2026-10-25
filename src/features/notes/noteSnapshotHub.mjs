export const NOTE_PAGE_SIZE=20;
const cursorKey=document=>document ? `${document.id}:${document.data().updatedAt?.seconds ?? ''}:${document.data().updatedAt?.nanoseconds ?? ''}` : '';

// List pages and opened editors share snapshots. Notes outside a page retain
// their own live listener so moving a page boundary never deletes an open draft.
export function createNoteSnapshotHub(listen,{listenBody} = {}) {
  const entries=new Map();
  const bodyValue=document=>({text:document?.data()?.text ?? '',revision:document?.data()?.revision ?? 0,
    deleted:!document || document.data()?.deleted === true});
  function deliverBody(entry,id,document) {
    const body=entry.bodies.get(id);
    if (!body || document?.metadata.hasPendingWrites) return;
    const value=bodyValue(document);
    for (const observer of body.observers) {
      const previous=observer.previous;
      if (previous && previous.text === value.text && previous.revision === value.revision && previous.deleted === value.deleted) continue;
      observer.previous=value;observer.next(value);
    }
  }
  function reconcileBodies(uid,entry) {
    for (const [id,body] of entry.bodies) {
      const document=entry.documents.get(id);
      if (document) {
        body.generation++;body.stop?.();body.stop=null;
        deliverBody(entry,id,document);
      } else if (listenBody && !body.stop) {
        const generation=++body.generation;
        body.stop=listenBody(uid,id,document=>{
          if (entries.get(uid) !== entry || body.generation !== generation || !body.observers.size) return;
          if (document?.metadata.hasPendingWrites) return;
          if (document) entry.known.set(id,{...document.data(),id});
          else entry.known.delete(id);
          deliverBody(entry,id,document);publish(entry);
        },error=>{
          if (entries.get(uid) === entry && body.generation === generation)
            for (const observer of body.observers) observer.error?.(error);
        });
      } else if (!listenBody && entry.complete && entry.folder === 'all') deliverBody(entry,id,null);
    }
  }
  function publish(entry,onlyObserver=null) {
    const pages=entry.pages;
    const ready=pages.length > 0 && pages.every(page=>page.snapshot && !page.loading);
    const last=pages.at(-1);
    entry.complete=ready && (entry.all || last.snapshot.docs.length < NOTE_PAGE_SIZE);
    const documents=new Map();
    for (const page of pages) for (const document of page.snapshot?.docs || []) documents.set(document.id,document);
    entry.documents=documents;
    for (const [id,document] of documents) entry.known.set(id,{...document.data(),id});
    entry.notes=[...documents.values()].map(document=>({...document.data(),id:document.id}));
    const serverReady=ready && pages.every(page=>!page.snapshot.metadata.fromCache && !page.snapshot.metadata.hasPendingWrites);
    const state={notes:entry.notes,documents:[...entry.known.values()],folder:entry.folder,all:entry.all,
      ready:!!pages[0]?.snapshot && !pages[0].loading,loadingMore:pages.slice(1).some(page=>page.loading),
      hasMore:!entry.complete,error:entry.error,serverReady};
    for (const observer of onlyObserver ? [onlyObserver] : [...entry.observers]) {
      if (observer.kind === 'server') {if (serverReady) observer.next(entry.notes);}
      else if (observer.kind === 'page') observer.next(state);
      else if (pages[0]?.snapshot && !entry.error) observer.next(entry.notes);
    }
  }
  function stopPages(entry,from=0) {
    for (const page of entry.pages.splice(from)) {page.generation++;page.stop?.();}
  }
  function startPage(uid,entry,index,cursor=null) {
    const old=entry.pages[index];old?.stop?.();
    if (old) old.generation++;
    const page={snapshot:old?.snapshot ?? null,loading:true,cursor:cursorKey(cursor),generation:0,stop:null};
    entry.pages[index]=page;
    const generation=page.generation;
    const current=()=>entries.get(uid) === entry && entry.pages[index] === page && page.generation === generation;
    const fail=error=>{
      if (!current()) return;
      page.loading=false;entry.error=error;
      publish(entry);
      for (const observer of [...entry.observers]) observer.error?.(error);
      for (const body of entry.bodies.values()) for (const observer of body.observers) observer.error?.(error);
    };
    try {
      page.stop=listen(uid,snapshot=>{
        if (!current()) return;
        page.snapshot=snapshot;page.loading=!!snapshot.metadata.fromCache;entry.error=null;
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
          const next=entry.pages[index+1],tail=snapshot.docs.at(-1);
          if (entry.all || snapshot.docs.length < NOTE_PAGE_SIZE) stopPages(entry,index+1);
          else if (next && next.cursor !== cursorKey(tail)) startPage(uid,entry,index+1,tail);
        }
        publish(entry);reconcileBodies(uid,entry);
      },fail,{folder:entry.folder,all:entry.all,cursor,pageSize:NOTE_PAGE_SIZE});
    } catch (error) {fail(error);}
  }
  function ensure(uid) {
    let entry=entries.get(uid);
    if (!entry) {
      entry={observers:new Set(),bodies:new Map(),pages:[],known:new Map(),documents:new Map(),notes:[],
        folder:'all',all:false,complete:false,error:null};
      entries.set(uid,entry);
    }
    return entry;
  }
  function release(uid,entry) {
    if (entry.observers.size || [...entry.bodies.values()].some(body=>body.observers.size) || entries.get(uid) !== entry) return;
    entries.delete(uid);stopPages(entry);
    for (const body of entry.bodies.values()) {body.generation++;body.stop?.();}
  }
  function add(uid,observer) {
    const entry=ensure(uid);entry.observers.add(observer);
    if (!entry.pages.length || entry.error) {entry.error=null;startPage(uid,entry,0);}
    else publish(entry,observer);
    return ()=>{entry.observers.delete(observer);release(uid,entry);};
  }
  return {
    subscribeList:(uid,next,error)=>add(uid,{kind:'list',next,error}),
    subscribePage:(uid,next,error)=>add(uid,{kind:'page',next,error}),
    subscribeBody(uid,id,next,error) {
      const entry=ensure(uid),observer={next,error};
      if (!entry.bodies.has(id)) entry.bodies.set(id,{observers:new Set(),stop:null,generation:0});
      const body=entry.bodies.get(id);body.observers.add(observer);
      if (!entry.pages.length) startPage(uid,entry,0);
      reconcileBodies(uid,entry);
      return ()=>{
        body.observers.delete(observer);
        if (!body.observers.size) {body.generation++;body.stop?.();entry.bodies.delete(id);}
        release(uid,entry);
      };
    },
    setView(uid,folder='all',all=false) {
      const entry=entries.get(uid);
      if (!entry || (entry.folder === folder && entry.all === all)) return;
      stopPages(entry);entry.folder=folder;entry.all=all;entry.error=null;
      startPage(uid,entry,0);publish(entry);reconcileBodies(uid,entry);
    },
    loadMore(uid) {
      const entry=entries.get(uid),last=entry?.pages.at(-1);
      if (!entry || entry.all || entry.complete || !last?.snapshot || entry.pages.some(page=>page.loading)) return;
      startPage(uid,entry,entry.pages.length,last.snapshot.docs.at(-1));publish(entry);
    },
    serverNotes(uid,{signal} = {}) {
      return new Promise((resolve,reject)=>{
        let done=false,stop=()=>{};
        const finish=(error,notes)=>{
          if (done) return;
          done=true;stop();signal?.removeEventListener('abort',abort);
          if (error) reject(error);else resolve(notes);
        };
        const abort=()=>finish(Object.assign(new Error('Note subscription cancelled'),{name:'AbortError'}));
        if (signal?.aborted) {abort();return;}
        signal?.addEventListener('abort',abort,{once:true});
        stop=add(uid,{kind:'server',next:notes=>finish(null,notes),error:finish});
        if (done) stop();
      });
    },
  };
}
