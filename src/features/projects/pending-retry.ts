export function pendingRetry(storage: Storage, account: string, project: string, kind: "import" | "transcription" | "restoration" = "import") {
  const name = `riflo:${kind}-retry:${account}:${project}`;
  return {
    read(): string | null {
      try {
        const value = storage.getItem(name);
        return value && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : null;
      } catch { return null; }
    },
    save(key: string) { storage.setItem(name, key); },
    clear(key?: string) { if (!key || storage.getItem(name) === key) storage.removeItem(name); },
  };
}
