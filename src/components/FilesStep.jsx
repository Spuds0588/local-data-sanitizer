import { useRef, useState } from 'react';
import { ACCEPT_ATTR } from '../lib/parsers/index.js';
import { FileIcon, TrashIcon, UploadIcon, XIcon } from './Icons.jsx';

const MAX_MB = 25;

function prettySize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function FilesStep({ files, errors, onFiles, onRemove, onClear }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-white px-6 py-12 text-center transition-colors ${
          dragging ? 'bg-neutral-900' : 'hover:bg-neutral-900'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <UploadIcon size={24} />
        <p className="text-xs font-medium">Drop files or click to browse</p>
        <p className="text-[11px] text-neutral-400">
          .docx · .xlsx · .xls · .csv · .json · .pdf · max {MAX_MB} MB each
        </p>
      </div>

      {errors.length > 0 && (
        <ul className="border border-white">
          {errors.map((err) => (
            <li key={err} className="border-b border-dashed border-white px-3 py-2 text-[11px] last:border-b-0">
              {err}
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <div className="border border-white">
          <div className="flex items-center justify-between border-b border-white px-3 py-2">
            <span className="text-[10px] uppercase tracking-widest">
              {files.length} file{files.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-1 text-[10px] uppercase tracking-widest hover:underline"
            >
              <TrashIcon size={12} /> Clear
            </button>
          </div>
          <ul>
            {files.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 border-b border-neutral-800 px-3 py-2 last:border-b-0"
              >
                <FileIcon size={14} className="shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{f.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-neutral-400">{prettySize(f.size)}</span>
                <button
                  type="button"
                  onClick={() => onRemove(f.id)}
                  className="shrink-0 hover:opacity-60"
                  aria-label={`Remove ${f.name}`}
                >
                  <XIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
