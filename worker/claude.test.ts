import { describe, expect, it } from 'vitest';
import { extractJson } from './claude';

describe('extractJson', () => {
  it('handles fences, prose and nested braces in strings', () => {
    expect(extractJson('Here you go:\n```json\n{"a": {"b": "x}y"}}\n```')).toEqual({ a: { b: 'x}y' } });
    expect(extractJson('blah {"q": "why \\"so\\"?"} trailing')).toEqual({ q: 'why "so"?' });
    expect(extractJson('[1, 2, {"c": [3]}]')).toEqual([1, 2, { c: [3] }]);
    expect(() => extractJson('nothing here')).toThrow();
  });
});
