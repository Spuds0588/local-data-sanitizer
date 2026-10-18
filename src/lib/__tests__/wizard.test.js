import { describe, expect, it } from 'vitest';
import { findStep, isStepAvailable, STEPS } from '../wizard.js';

describe('wizard model', () => {
  it('is exactly three steps', () => {
    expect(STEPS.map((s) => s.key)).toEqual(['files', 'rules', 'review']);
  });

  it('gates review on having at least one file', () => {
    expect(isStepAvailable(2, { fileCount: 0 })).toBe(false);
    expect(isStepAvailable(2, { fileCount: 1 })).toBe(true);
    expect(isStepAvailable(1, { fileCount: 0 })).toBe(true);
    expect(isStepAvailable(0, {})).toBe(true);
    expect(isStepAvailable(3, { fileCount: 1 })).toBe(false);
    expect(isStepAvailable(-1, { fileCount: 1 })).toBe(false);
  });

  it('walks to the nearest available step', () => {
    expect(findStep(0, 1, { fileCount: 0 })).toBe(1);
    expect(findStep(1, 1, { fileCount: 2 })).toBe(2);
    expect(findStep(1, 1, { fileCount: 0 })).toBe(1);
    expect(findStep(2, -1, { fileCount: 2 })).toBe(1);
    expect(findStep(0, -1, {})).toBe(0);
  });
});
