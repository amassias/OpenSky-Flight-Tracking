import { useState } from "react";

export function usePersistentState<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  function updateValue(nextValue: T) {
    setValue(nextValue);
    try {
      window.localStorage.setItem(key, JSON.stringify(nextValue));
    } catch {
      // The interface remains usable when storage is disabled.
    }
  }

  return [value, updateValue];
}
