import { isStepAvailable, STEPS } from '../lib/wizard.js';
import { CheckIcon } from './Icons.jsx';

export default function StepNav({ current, context, onGo }) {
  return (
    <nav aria-label="Progress" className="border-b border-white">
      <ol className="mx-auto flex max-w-3xl items-stretch px-6">
        {STEPS.map((step, i) => {
          const available = isStepAvailable(i, context);
          const active = i === current;
          const done = i < current;
          return (
            <li key={step.key} className="flex flex-1 items-center gap-3 py-3">
              <button
                type="button"
                onClick={() => onGo(i)}
                disabled={!available}
                aria-current={active ? 'step' : undefined}
                className={`flex flex-1 items-center gap-2 text-left text-[11px] uppercase tracking-widest ${
                  available ? 'hover:underline' : 'cursor-not-allowed text-neutral-600'
                } ${active ? 'font-semibold' : ''}`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center border border-current text-[10px] ${
                    active || done ? 'bg-white text-black' : 'bg-black'
                  }`}
                >
                  {done ? <CheckIcon size={12} /> : i + 1}
                </span>
                {step.label}
              </button>
              {i < STEPS.length - 1 && <span className="h-px w-8 shrink-0 bg-white" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
