import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CONFIG } from '../lib/rules.js';
import { analyzeFiles, sanitizeFiles, downloadBlob } from '../lib/engine.js';
import { ACCEPTED_EXTENSIONS } from '../lib/parsers/index.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB hard limit (PRD 3.1)

let idCounter = 0;
const nextId = () => `f${(idCounter += 1)}`;

function validateFile(file) {
  const ext = /\.([^.]+)$/.exec(file.name || '');
  const extension = ext ? ext[1].toLowerCase() : '';
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    return `"${file.name}" is not supported. Allowed: ${ACCEPTED_EXTENSIONS.join(', ')}.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — over the 25 MB limit.`;
  }
  return null;
}

export function useSanitizer() {
  const [config, setConfig] = useState(() => structuredClone(DEFAULT_CONFIG));
  const [files, setFiles] = useState([]);
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | scanning | ready | sanitizing | done
  const [errors, setErrors] = useState([]);
  const [downloads, setDownloads] = useState([]);

  const log = useCallback((message) => {
    console.log('[UI]', message);
  }, []);

  const addFiles = useCallback(
    (fileList) => {
      const incoming = Array.from(fileList || []);
      const problems = [];
      const accepted = [];
      for (const file of incoming) {
        const problem = validateFile(file);
        if (problem) {
          problems.push(problem);
          console.warn('[UI] Rejected file:', problem);
        } else {
          accepted.push({ id: nextId(), file, name: file.name, size: file.size });
        }
      }
      if (problems.length) setErrors(problems);
      if (accepted.length) {
        setErrors([]);
        setFiles((prev) => [...prev, ...accepted]);
        setDownloads([]);
        accepted.forEach((f) => log(`Added "${f.name}" (${(f.size / 1024).toFixed(1)} KB).`));
      }
    },
    [log],
  );

  const removeFile = useCallback((id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setEntries([]);
    setDownloads([]);
    setStatus('idle');
  }, []);

  // Re-scan whenever files or rules change (debounced so typing a keyword is cheap).
  useEffect(() => {
    if (files.length === 0) {
      setEntries([]);
      setStatus('idle');
      return undefined;
    }
    let cancelled = false;
    setStatus('scanning');
    const timer = setTimeout(async () => {
      try {
        const found = await analyzeFiles(
          files.map((f) => f.file),
          config,
          log,
        );
        if (!cancelled) {
          setEntries(found);
          setStatus('ready');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[UI] Analysis failed:', err);
          setErrors([err.message || String(err)]);
          setStatus('idle');
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [files, config, log]);

  const toggleEntry = useCallback((id) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)),
    );
  }, []);

  const setFakeValue = useCallback((id, fakeValue) => {
    console.log('[UI] Manual override for', id, '->', fakeValue);
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, fakeValue } : e)));
  }, []);

  const setAllEnabled = useCallback((enabled) => {
    setEntries((prev) => prev.map((e) => ({ ...e, enabled })));
  }, []);

  const updateConfig = useCallback((updater) => {
    setConfig((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);

  const addKeyword = useCallback(
    (keyword) => {
      const k = keyword.trim();
      if (!k) return;
      setConfig((prev) =>
        prev.customKeywords.some((x) => x.toLowerCase() === k.toLowerCase())
          ? prev
          : { ...prev, customKeywords: [...prev.customKeywords, k] },
      );
      log(`Added custom keyword "${k}".`);
    },
    [log],
  );

  const removeKeyword = useCallback((keyword) => {
    setConfig((prev) => ({
      ...prev,
      customKeywords: prev.customKeywords.filter((k) => k !== keyword),
    }));
  }, []);

  const sanitize = useCallback(async () => {
    if (files.length === 0) return;
    setStatus('sanitizing');
    try {
      const active = entries.filter((e) => e.enabled);
      log(`Applying ${active.length} replacement(s) to ${files.length} file(s)…`);
      const results = await sanitizeFiles(
        files.map((f) => f.file),
        entries,
        log,
      );
      results.forEach((r) => downloadBlob(r.blob, r.name));
      setDownloads(results.map((r) => ({ name: r.name, size: r.blob.size })));
      setStatus('done');
      log(`Done. ${results.length} sanitized file(s) downloaded.`);
    } catch (err) {
      console.error('[UI] Sanitization failed:', err);
      setErrors([err.message || String(err)]);
      setStatus('ready');
    }
  }, [entries, files, log]);

  const exportRules = useCallback(() => {
    const payload = JSON.stringify({ ...config, version: 1 }, null, 2);
    downloadBlob(new Blob([payload], { type: 'application/json' }), 'rules.json');
    log('Exported rules.json.');
  }, [config, log]);

  const importRules = useCallback(
    async (file) => {
      try {
        const parsed = JSON.parse(await file.text());
        setConfig({
          rules: { ...DEFAULT_CONFIG.rules, ...(parsed.rules || {}) },
          customKeywords: Array.isArray(parsed.customKeywords) ? parsed.customKeywords : [],
        });
        log(`Imported rules from "${file.name}".`);
      } catch (err) {
        setErrors([`Could not read rules file: ${err.message}`]);
      }
    },
    [log],
  );

  const enabledCount = entries.filter((e) => e.enabled).length;

  return {
    config,
    files,
    entries,
    status,
    errors,
    downloads,
    enabledCount,
    addFiles,
    removeFile,
    clearAll,
    toggleEntry,
    setFakeValue,
    setAllEnabled,
    updateConfig,
    addKeyword,
    removeKeyword,
    sanitize,
    exportRules,
    importRules,
  };
}
