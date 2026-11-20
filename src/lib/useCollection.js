import { useState, useEffect } from "react";

// Live Firestore data for one account. `scope` names what is being read: when it
// or the account changes, the previous data is hidden until the new read arrives.
// A changed `retry` value reconnects the same read.
export function useLiveData(uid, scope, subscribe, retry) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!uid) return;
    let active = true;
    let unsubscribe;
    // StrictMode's discarded setup must not open a second server listener.
    queueMicrotask(() => {
      if (!active) return;
      const onError = error => {
        if (active) setSnapshot({ uid, scope, data: [], error });
      };
      try {
        unsubscribe = subscribe(uid, data => {
          if (active) setSnapshot({ uid, scope, data, error: null });
        }, onError);
      } catch (error) { onError(error); }
    });
    return () => { active = false; unsubscribe?.(); };
  }, [uid, scope, subscribe, retry]);
  if (!uid) return { data: [], loading: false, error: null };
  if (snapshot?.uid !== uid || snapshot?.scope !== scope) return { data: [], loading: true, error: null };
  return { data: snapshot.data, loading: false, error: snapshot.error };
}

// [data, ready, error]; the subscribe function itself is the scope.
export function useCollection(uid, subscribe) {
  const { data, loading, error } = useLiveData(uid, subscribe, subscribe);
  return [data, !loading, error];
}
