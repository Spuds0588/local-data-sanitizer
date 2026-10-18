import { AlertIcon, CheckIcon, DownloadIcon } from './Icons.jsx';

export default function ReviewStep({ entries, enabledCount, status, downloads, onToggle, onSetFake, onSetAll, onSanitize }) {
  const scanning = status === 'scanning';
  const busy = status === 'sanitizing';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-[11px] text-neutral-500">
          <span className="font-mono text-black">{entries.length}</span> flagged ·{' '}
          <span className="font-mono text-black">{enabledCount}</span> selected
          {scanning && ' · scanning…'}
        </p>
        <button
          type="button"
          onClick={() => onSetAll(true)}
          className="border border-black px-2.5 py-1.5 text-[10px] uppercase tracking-widest hover:bg-black hover:text-white"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => onSetAll(false)}
          className="border border-black px-2.5 py-1.5 text-[10px] uppercase tracking-widest hover:bg-black hover:text-white"
        >
          None
        </button>
        <button
          type="button"
          disabled={busy || enabledCount === 0}
          onClick={onSanitize}
          className="flex items-center gap-1.5 border border-black bg-black px-3 py-1.5 text-[10px] uppercase tracking-widest text-white hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500"
        >
          <DownloadIcon size={12} /> {busy ? 'Sanitizing…' : 'Sanitize & download'}
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="flex items-center gap-2 border border-dashed border-black px-4 py-8 text-[11px] text-neutral-500">
          <AlertIcon size={14} /> Nothing flagged yet. Enable more patterns, or add custom keywords.
        </p>
      ) : (
        <div className="max-h-[26rem] overflow-auto border border-black">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 border-b border-black bg-white text-[10px] uppercase tracking-widest">
              <tr>
                <th className="w-10 px-3 py-2 font-normal">Use</th>
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal">Original</th>
                <th className="px-3 py-2 font-normal">Replacement</th>
                <th className="px-3 py-2 font-normal">Hits</th>
                <th className="px-3 py-2 font-normal">Context</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-neutral-200 align-top last:border-b-0">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={() => onToggle(entry.id)}
                      className="h-3.5 w-3.5 accent-black"
                      aria-label={`Include ${entry.original}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="border border-black px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                      {entry.type}
                    </span>
                  </td>
                  <td className={`px-3 py-2 font-mono ${entry.enabled ? '' : 'text-neutral-400 line-through'}`}>
                    {entry.original}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={entry.fakeValue}
                      onChange={(e) => onSetFake(entry.id, e.target.value)}
                      className="w-44 border border-neutral-400 px-2 py-1 font-mono text-[11px] outline-none focus:border-black focus:bg-black focus:text-white"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-neutral-500">{entry.count}</td>
                  <td className="max-w-xs px-3 py-2 font-mono text-[11px] text-neutral-500">{entry.context}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {downloads.length > 0 && (
        <div className="border border-black">
          <p className="flex items-center gap-1.5 border-b border-neutral-200 px-3 py-2 text-[10px] uppercase tracking-widest">
            <CheckIcon size={12} /> Downloaded {downloads.length} file{downloads.length === 1 ? '' : 's'}
          </p>
          <ul>
            {downloads.map((d) => (
              <li key={d.name} className="border-b border-neutral-200 px-3 py-2 font-mono text-[11px] last:border-b-0">
                {d.name} <span className="text-neutral-500">({d.size} bytes)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
