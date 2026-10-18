import { useRef, useState } from 'react';
import { RULE_DEFS } from '../lib/rules.js';
import { CheckIcon, DownloadIcon, PlusIcon, UploadIcon, XIcon } from './Icons.jsx';

function Check({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-4 w-4 shrink-0 items-center justify-center border border-black ${
        checked ? 'bg-black text-white' : 'bg-white'
      }`}
    >
      {checked && <CheckIcon size={11} />}
    </button>
  );
}

export default function RulesStep({ config, updateConfig, addKeyword, removeKeyword, exportRules, importRules }) {
  const [keyword, setKeyword] = useState('');
  const importRef = useRef(null);

  const toggleRule = (id) => {
    updateConfig((prev) => ({ ...prev, rules: { ...prev.rules, [id]: !prev.rules[id] } }));
  };

  const submitKeyword = (e) => {
    e.preventDefault();
    addKeyword(keyword);
    setKeyword('');
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-[10px] uppercase tracking-widest text-neutral-500">Patterns</h2>
        <ul className="border border-black">
          {Object.values(RULE_DEFS).map((rule) => (
            <li
              key={rule.id}
              className="flex items-start gap-3 border-b border-neutral-200 px-3 py-3 last:border-b-0"
            >
              <Check
                checked={!!config.rules[rule.id]}
                onChange={() => toggleRule(rule.id)}
                label={`Detect ${rule.label}`}
              />
              <div className="min-w-0">
                <p className="text-xs font-medium">{rule.label}</p>
                <p className="text-[11px] text-neutral-500">{rule.hint}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-[10px] uppercase tracking-widest text-neutral-500">Custom keywords</h2>
        <form onSubmit={submitKeyword} className="flex gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Project Phoenix, Elon Musk…"
            className="min-w-0 flex-1 border border-black px-3 py-2 text-xs outline-none placeholder:text-neutral-400 focus:bg-black focus:text-white"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 border border-black bg-black px-3 py-2 text-[10px] uppercase tracking-widest text-white hover:bg-white hover:text-black"
          >
            <PlusIcon size={12} /> Add
          </button>
        </form>

        {config.customKeywords.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {config.customKeywords.map((k) => (
              <li key={k} className="flex items-center gap-2 border border-black px-2 py-1 font-mono text-[11px]">
                {k}
                <button type="button" onClick={() => removeKeyword(k)} aria-label={`Remove ${k}`} className="hover:opacity-60">
                  <XIcon size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[10px] uppercase tracking-widest text-neutral-500">Profile</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportRules}
            className="flex items-center gap-1.5 border border-black px-3 py-2 text-[10px] uppercase tracking-widest hover:bg-black hover:text-white"
          >
            <DownloadIcon size={12} /> Export rules.json
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="flex items-center gap-1.5 border border-black px-3 py-2 text-[10px] uppercase tracking-widest hover:bg-black hover:text-white"
          >
            <UploadIcon size={12} /> Import rules.json
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) importRules(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
      </section>
    </div>
  );
}
