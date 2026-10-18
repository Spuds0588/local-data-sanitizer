// The wizard is the whole app: three linear steps, nothing else.
export const STEPS = [
  { key: 'files', label: 'Files' },
  { key: 'rules', label: 'Rules' },
  { key: 'review', label: 'Review' },
];

/** Review is meaningless without at least one document loaded. */
export function isStepAvailable(index, { fileCount = 0 } = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= STEPS.length) return false;
  if (STEPS[index].key === 'review') return fileCount > 0;
  return true;
}

/** Nearest available step in `direction`, or the current index if there is none. */
export function findStep(from, direction, context) {
  for (let i = from + direction; i >= 0 && i < STEPS.length; i += direction) {
    if (isStepAvailable(i, context)) return i;
  }
  return from;
}
