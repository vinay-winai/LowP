import {useEffect, useRef, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {SEARCH_HISTORY_KEY, normalizeSearchHistory, historyMatches} from './SearchHistory';

export function useSearchHistory(query: string) {
  const [history, setHistory] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [settledQuery, setSettledQuery] = useState<string | null>(null);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SEARCH_HISTORY_KEY).then(raw => {
      let saved: string[] = [];
      try { saved = normalizeSearchHistory(raw ? JSON.parse(raw) : []); } catch {}
      if (!cancelled) setHistory(current => normalizeSearchHistory([...current, ...saved]));
    }).catch(() => {}).finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    writes.current = writes.current.then(() => AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history))).catch(() => {});
  }, [history, ready]);
  useEffect(() => {
    setSettledQuery(null);
    const timer = setTimeout(() => setSettledQuery(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const suggestions = !query.trim() ? historyMatches(history, '')
    : query === settledQuery ? historyMatches(history, query) : [];
  return {suggestions, remember: (term: string) => setHistory(current => normalizeSearchHistory([term, ...current]))};
}
