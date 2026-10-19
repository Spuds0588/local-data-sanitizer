import { useState } from 'react';
import Header from './components/Header.jsx';
import StepNav from './components/StepNav.jsx';
import FilesStep from './components/FilesStep.jsx';
import RulesStep from './components/RulesStep.jsx';
import ReviewStep from './components/ReviewStep.jsx';
import ShareBar from './components/ShareBar.jsx';
import { ArrowLeftIcon, ArrowRightIcon } from './components/Icons.jsx';
import { findStep, isStepAvailable, STEPS } from './lib/wizard.js';
import { useSanitizer } from './state/useSanitizer.js';

export default function App() {
  const s = useSanitizer();
  const [step, setStep] = useState(0);

  const context = { fileCount: s.files.length };
  // If a step stops being reachable (e.g. every file was cleared), fall back.
  const current = isStepAvailable(step, context) ? step : findStep(step, -1, context);
  const previous = findStep(current, -1, context);
  const next = findStep(current, 1, context);
  const key = STEPS[current].key;

  const restart = () => {
    s.restart();
    setStep(0);
  };

  const panel = {
    files: (
      <FilesStep
        files={s.files}
        errors={s.errors}
        onFiles={s.addFiles}
        onRemove={s.removeFile}
        onClear={s.clearAll}
      />
    ),
    rules: (
      <RulesStep
        config={s.config}
        updateConfig={s.updateConfig}
        addKeyword={s.addKeyword}
        removeKeyword={s.removeKeyword}
        exportRules={s.exportRules}
        importRules={s.importRules}
      />
    ),
    review: (
      <ReviewStep
        entries={s.entries}
        enabledCount={s.enabledCount}
        status={s.status}
        downloads={s.downloads}
        onToggle={s.toggleEntry}
        onSetFake={s.setFakeValue}
        onSetAll={s.setAllEnabled}
        onSanitize={s.sanitize}
      />
    ),
  }[key];

  return (
    <div className="min-h-screen">
      <Header onRestart={restart} canRestart={s.files.length > 0} />
      <StepNav current={current} context={context} onGo={setStep} />

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="border border-white p-5">{panel}</div>

        <div className="mt-5 flex items-center gap-2">
          {previous !== current && (
            <button
              type="button"
              onClick={() => setStep(previous)}
              className="flex items-center gap-1.5 border border-white px-3 py-2 text-[10px] uppercase tracking-widest hover:bg-white hover:text-black"
            >
              <ArrowLeftIcon size={12} /> Back
            </button>
          )}
          {next !== current && (
            <button
              type="button"
              onClick={() => setStep(next)}
              className="ml-auto flex items-center gap-1.5 border border-white bg-white px-3 py-2 text-[10px] uppercase tracking-widest text-black hover:bg-black hover:text-white"
            >
              Next <ArrowRightIcon size={12} />
            </button>
          )}
        </div>

        <p className="mt-6 text-[11px] text-neutral-400">
          Nothing is uploaded. PDFs export as plain .txt; everything else keeps its format.
          Amounts are jiggled by up to ±20%.
        </p>

        <ShareBar />
      </main>
    </div>
  );
}
