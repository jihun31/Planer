import { useEffect, useState } from 'react';
import { migrateLegacyControlBlocks } from './controlService';

const inFlight = new Map();

function migrateOnce(uid) {
  if (!inFlight.has(uid)) {
    const task = migrateLegacyControlBlocks(uid).finally(() => {
      if (inFlight.get(uid) === task) inFlight.delete(uid);
    });
    inFlight.set(uid, task);
  }
  return inFlight.get(uid);
}

export function useLegacyBlockMigration(uid) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!uid) return;
    let active = true;
    migrateOnce(uid).then(
      () => { if (active) setResult({ uid, attempt, error: null }); },
      error => { if (active) setResult({ uid, attempt, error }); },
    );
    return () => { active = false; };
  }, [uid, attempt]);
  const current = result?.uid === uid && result?.attempt === attempt ? result : null;
  return {
    ready: !!current && !current.error,
    error: current?.error || null,
    retry: () => setAttempt(value => value + 1),
  };
}
