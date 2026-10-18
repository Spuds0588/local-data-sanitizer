import { useState } from 'react';
import { LinkIcon, ShareIcon, StarIcon } from './Icons.jsx';
import { REPO_URL, SHARE_TEXT, copyToClipboard, pageUrl } from '../lib/share.js';

const ACTIONS = 'flex items-center gap-1.5 hover:text-white';

export default function ShareBar() {
  const [status, setStatus] = useState('idle'); // idle | copied | failed
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const url = pageUrl();

  const copy = async () => {
    const ok = await copyToClipboard(url);
    setStatus(ok ? 'copied' : 'failed');
    setTimeout(() => setStatus('idle'), 2000);
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'Scrub-Hub', text: SHARE_TEXT, url });
    } catch {
      // The sheet was dismissed, or the browser changed its mind about sharing.
    }
  };

  return (
    <footer className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-neutral-800 pt-4 text-[10px] uppercase tracking-widest text-neutral-400">
      <p className="w-full text-[11px] normal-case tracking-normal sm:mr-auto sm:w-auto">
        Scrub-Hub is free and open source.
      </p>

      <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={ACTIONS}>
        <StarIcon size={12} /> Star the repo
      </a>

      <button type="button" onClick={copy} className={ACTIONS}>
        <LinkIcon size={12} />
        {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy link'}
      </button>

      {canShare && (
        <button type="button" onClick={share} className={ACTIONS}>
          <ShareIcon size={12} /> Share
        </button>
      )}

      <span aria-live="polite" className="sr-only">
        {status === 'copied' ? 'Link copied to clipboard' : status === 'failed' ? 'Could not copy the link' : ''}
      </span>
    </footer>
  );
}
