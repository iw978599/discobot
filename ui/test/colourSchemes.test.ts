import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCHEMES, asSchemeChoice, resolveScheme } from '../src/services/colourScheme.ts';

// Each colour scheme is a block of names in rack.css. These read the blocks as written and
// measure the pairs that carry words and lights, as legibility.spec.ts does for Studio in a browser.
const css = readFileSync(new URL('../src/rack/rack.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `rack.css has ${selector}`);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
}
const studio = block('.rack-page [data-sample="studio"]');
const scheme = (id: string) => (id === 'studio' ? studio : { ...studio, ...block(`:root[data-scheme="${id}"] .rack-page`) });

const rgb = (value: string): number[] => {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(at => parseInt(hex[1].slice(at, at + 2), 16));
  throw new Error(`not a solid colour: ${value}`);
};
const light = (value: string) => {
  const [r, g, b] = rgb(value).map(channel => { const unit = channel / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [light(a), light(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Words against what they lie on, at 4.5 to 1; an edge or a ring that must be seen, at 3 to 1.
const WORDS: Array<[string, string]> = [
  ['--text', '--surface-panel-top'], ['--text', '--surface-panel-bottom'], ['--text', '--surface-control'], ['--text', '--surface-field'],
  ['--text-plain', '--surface-inset'], ['--text-plain', '--surface-panel-bottom'],
  ['--text-label', '--surface-panel-top'], ['--text-label', '--surface-panel-bottom'],
  ['--text-faint', '--surface-panel-top'], ['--text-faint', '--surface-panel-bottom'], ['--text-faint', '--surface-control'], ['--text-faint', '--surface-well'],
  ['--value', '--surface-panel-top'], ['--value', '--surface-display'],
  ['--text-on', '--on'], ['--action-text', '--action'], ['--action-text', '--action-hover'],
  ['--danger-ink', '--danger-surface'], ['--danger-word', '--surface-panel-top'],
];
const SEEN: Array<[string, string]> = [['--focus', '--gap'], ['--select', '--surface-well'], ['--lit', '--surface-panel-top'], ['--on', '--surface-well'], ['--edge-beat', '--surface-panel-top']];

for (const { id } of SCHEMES.filter(entry => entry.id !== 'device')) {
  test(`${id}: words can be read and lights and rings can be seen`, () => {
    const colours = scheme(id);
    for (const [ink, under] of WORDS) assert.ok(contrast(colours[ink], colours[under]) >= 4.5, `${ink} on ${under}: ${contrast(colours[ink], colours[under]).toFixed(2)}`);
    for (const [mark, under] of SEEN) assert.ok(contrast(colours[mark], colours[under]) >= 3, `${mark} against ${under}: ${contrast(colours[mark], colours[under]).toFixed(2)}`);
  });
}

test('every scheme names every colour Studio does, but the drums\', the scenes\' and the people\'s', () => {
  const own = Object.keys(studio).filter(name => !/^--(drum|scene|person)-/.test(name) && !/^--(type|corner|panel-font|sentence-font|led-font|plate|side|knobs|surface-panel$|shadow)/.test(name));
  for (const { id } of SCHEMES.filter(entry => entry.id !== 'device' && entry.id !== 'studio')) {
    const named = block(`:root[data-scheme="${id}"] .rack-page`);
    assert.deepEqual(own.filter(name => !(name in named)), [], `${id} leaves nothing to Studio`);
    assert.ok(css.includes(`.rack-page [data-sample="${id}"]`), `${id} has a sample`);
  }
});

test('the choice is one of the schemes, and Match This Device picks light or dark', () => {
  for (const { id } of SCHEMES) assert.equal(asSchemeChoice(id), id);
  for (const bad of ['', 'light', 'Studio', null, 3, {}]) assert.equal(asSchemeChoice(bad), null);
  assert.equal(resolveScheme('device', true), 'daylight');
  assert.equal(resolveScheme('device', false), 'studio');
  assert.equal(resolveScheme('midnight', true), 'midnight');
});
