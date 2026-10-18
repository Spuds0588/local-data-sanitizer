import { ShieldIcon } from './Icons.jsx';

export default function Header() {
  return (
    <header className="border-b border-white">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
        <ShieldIcon size={20} />
        <div className="mr-auto leading-tight">
          <h1 className="text-sm font-semibold tracking-tight">Scrub-Hub</h1>
          <p className="text-[11px] text-neutral-400">Local data sanitizer for LLM training data</p>
        </div>
        <p className="hidden text-[11px] text-neutral-400 sm:block">Runs entirely in this browser</p>
      </div>
    </header>
  );
}
