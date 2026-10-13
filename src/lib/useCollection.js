import { useState, useEffect } from "react";

export function useCollection(uid, subscribe) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!uid) return;
    let active = true;
    let unsubscribe;
    queueMicrotask(() => {
      if (!active) return;
      const onError = error => {
        if (active) setSnapshot({ uid, subscribe, data: [], error });
      };
      try {
        unsubscribe = subscribe(uid, data => {
          if (active) setSnapshot({ uid, subscribe, data, error: null });
        }, onError);
      } catch (error) { onError(error); }
    });
    return () => { active = false; unsubscribe?.(); };
  }, [uid, subscribe]);
  if (!uid) return [[], true, null];
  if (snapshot?.uid !== uid || snapshot?.subscribe !== subscribe) return [[], false, null];
  return [snapshot.data, true, snapshot.error];
}
