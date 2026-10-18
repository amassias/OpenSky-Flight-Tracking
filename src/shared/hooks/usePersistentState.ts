import { useCallback, useEffect, useRef, useState } from "react";

type Updater<T> = T | ((current: T) => T);

function readStored<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * useState backed by localStorage. The setter is referentially stable and
 * accepts an updater function, so callers can update from the latest value
 * without listing the state in their dependency arrays.
 */
export function usePersistentState<T>(key: string, initialValue: T): [T, (value: Updater<T>) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, initialValue));

  // Mirrors the latest state so the stable setter can resolve updater
  // functions without re-creating itself on every change.
  const valueRef = useRef(value);
  valueRef.current = value;
  const keyRef = useRef(key);
  keyRef.current = key;

  const updateValue = useCallback((next: Updater<T>) => {
    const resolved = typeof next === "function" ? (next as (current: T) => T)(valueRef.current) : next;
    valueRef.current = resolved;
    setValue(resolved);
    try {
      window.localStorage.setItem(keyRef.current, JSON.stringify(resolved));
    } catch {
      // The interface remains usable when storage is disabled.
    }
  }, []);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== keyRef.current) return;
      const next = event.newValue == null ? initialValue : readStored(keyRef.current, initialValue);
      valueRef.current = next;
      setValue(next);
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, updateValue];
}
