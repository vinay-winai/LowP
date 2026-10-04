import {useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {PlatformId} from '../types';
import {StoreSession, SessionCheckJob, SESSION_CHECK_STORES, SESSION_STORAGE_KEY, restoreSessionCache, restoreLastSyncedAt, updateStoreSession} from './StoreSession';

export function useSessionChecks(blocked: boolean, launchReady: boolean) {
  const [sessions, setSessions] = useState<Partial<Record<PlatformId, StoreSession>>>({});
  const [ready, setReady] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(0);
  const manualSync = useRef(false);
  const savedSessions = useRef<Partial<Record<PlatformId, StoreSession>>>({});
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [queue, setQueue] = useState<PlatformId[]>([]);
  const [job, setJob] = useState<SessionCheckJob | null>(null);
  const jobRef = useRef(job); jobRef.current = job;
  const paused = blocked || !appActive || !launchReady;
  if (paused) jobRef.current = null;
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SESSION_STORAGE_KEY).then(raw => {if (active) {const restored = restoreSessionCache(raw); savedSessions.current = restored; setSessions(previous => ({...restored, ...previous})); setLastSyncedAt(restoreLastSyncedAt(raw));}})
      .catch(() => {}).finally(() => {if (active) setReady(true);});
    return () => {active = false;};
  }, []);
  useEffect(() => {
    if (!ready) return;
    const settled = Object.fromEntries(Object.entries(sessions).filter(([, value]) => value?.status !== 'checking'));
    savedSessions.current = {...savedSessions.current, ...settled};
    AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({sessions: savedSessions.current, lastSyncedAt})).catch(() => {});
  }, [sessions, ready, lastSyncedAt]);
  useEffect(() => {
    if (ready && manualSync.current && queue.length === 0 && !job) {
      manualSync.current = false; setLastSyncedAt(Date.now());
    }
  }, [ready, queue, job]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      setAppActive(state === 'active');
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (paused) {if (job) setJob(null); return;}
    if (!ready || job || !queue.length) return;
    // Give the initial screen a frame, and let a user search preempt dispatch.
    const timer = setTimeout(() => {
      const platformId = queue[0];
      setJob({platformId, token: `session:${platformId}:${Date.now()}:${Math.random()}`});
      setSessions(previous => updateStoreSession(previous, platformId, {status:'checking', evidence:'none', checkedAt:Date.now()}));
    }, 500);
    return () => clearTimeout(timer);
  }, [paused, ready, job, queue]);
  const observe = (id: PlatformId, observation: StoreSession) => {
    const canonical = id === 'amazon_tez' ? 'amazon_main' : id;
    // Saved sync results change only during a user-requested sync.
    if (!queue.includes(canonical)) return;
    setSessions(previous => updateStoreSession(previous, id, observation));
    if (observation.status === 'signed_in' || observation.status === 'signed_out') {
      const canonical = id === 'amazon_tez' ? 'amazon_main' : id;
      setQueue(previous => previous.filter(store => store !== canonical));
      if (jobRef.current?.platformId === canonical) {jobRef.current = null; setJob(null);}
    }
  };
  const finish = (token: string, id: PlatformId, observation: StoreSession) => {
    if (jobRef.current?.token !== token || jobRef.current.platformId !== id) return;
    jobRef.current = null;
    setSessions(previous => updateStoreSession(previous, id, observation));
    setQueue(previous => previous.filter(store => store !== id));
    setJob(null);
  };
  const refresh = () => {manualSync.current = true; setQueue(previous => [...new Set([...previous, ...SESSION_CHECK_STORES])]);};
  return {sessions, setSessions, observe, finish, refresh, lastSyncedAt, pendingCount: queue.length,
    syncing: ready && launchReady && !paused && queue.length > 0,
    paused: paused && queue.length > 0, job: paused ? null : job, appActive};
}
