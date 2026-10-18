import { RestartIcon, ShieldIcon } from './Icons.jsx';

export default function Header({ onRestart, canRestart = false }) {
  return (
    <header className="border-b border-white">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
        <ShieldIcon size={20} />
        <div className="mr-auto leading-tight">
          <h1 className="text-sm font-semibold tracking-tight">Scrub-Hub</h1>
          <p className="text-[11px] text-neutral-400">Local data sanitizer for LLM training data</p>
        </div>
        <p className="hidden text-[11px] text-neutral-400 sm:block">Runs entirely in this browser</p>
        <button
          type="button"
          onClick={onRestart}
          disabled={!canRestart}
          className="flex shrink-0 items-center gap-1.5 border border-white px-2.5 py-1.5 text-[10px] uppercase tracking-widest hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:border-neutral-700 disabled:text-neutral-600 disabled:hover:bg-transparent disabled:hover:text-neutral-600"
        >
          <RestartIcon size={12} /> Start over
        </button>
      </div>
    </header>
  );
}
