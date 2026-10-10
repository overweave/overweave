import { describe, expect, it } from 'vitest';
import { world } from './index.ts';
import { mount } from './preact/index.ts';

describe('mount without a DOM', () => {
  it('says what it needs', () => {
    expect(() => mount(world(), null)).toThrow(/needs a DOM/);
  });
});
