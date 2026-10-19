import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide
// screen; `less` puts it away again after something that leaves it up.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
const less = async (page: Page) => {
  if (await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close more controls', exact: true }).click();
};

// Pictures of the real app for a design review (docs/DESIGN_REVIEW.md). Nothing here checks the
// app: each test walks to a screen and saves a picture of it into test-results/, which the check
// on GitHub uploads. It runs only when DESIGN_SHOTS is set, which ci.yml does for a branch whose
// name contains "design-review". A screen that cannot be reached is logged and left out, so one
// broken step never costs the other pictures.
test.skip(!process.env.DESIGN_SHOTS, 'design screenshots are taken only on a design-review branch');
test.describe.configure({ retries: 0, timeout: 300_000 });

const PASSWORD = 'correct horse battery';
const UNIT_KEY = 'discobot_rack_unit_v1';
const apiUrl = (info: TestInfo) => `http://127.0.0.1:${Number(new URL(String(info.project.use.baseURL)).port) + 1000}`;

interface Walk { page: Page; info: TestInfo; phone: boolean; missed: string[] }

const begin = (page: Page, info: TestInfo): Walk => {
  page.setDefaultTimeout(6_000);
  return { page, info, phone: info.project.name === 'mobile-chromium', missed: [] };
};
const finish = (walk: Walk) => {
  writeFileSync(walk.info.outputPath('skipped.txt'), walk.missed.length ? walk.missed.join('\n') : 'nothing was skipped');
};

// One screen. Whatever goes wrong inside is written down and the walk goes on.
const attempt = async (walk: Walk, name: string, body: () => Promise<void>) => {
  await test.step(name, async () => {
    try {
      await body();
    } catch (error) {
      const why = String(error).split('\n')[0].slice(0, 240);
      walk.missed.push(`${name}: ${why}`);
      console.log(`design-shots (${walk.info.project.name}): skipped ${name}: ${why}`);
      for (let press = 0; press < 2; press += 1) await walk.page.keyboard.press('Escape').catch(() => {});
    }
  });
};

const shot = (walk: Walk, name: string, page: Page = walk.page) => page.screenshot({ path: walk.info.outputPath(`${name}.png`) });

// A picture of one control and what is round it, cut from the screen as it stands.
const near = async (walk: Walk, target: Locator, name: string, pad = 110) => {
  await target.first().scrollIntoViewIfNeeded();
  const box = await target.first().boundingBox();
  const view = walk.page.viewportSize();
  if (!box || !view) throw new Error(`${name}: nothing to photograph`);
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  const width = Math.min(view.width, box.x + box.width + pad) - x, height = Math.min(view.height, box.y + box.height + pad) - y;
  await walk.page.screenshot({ path: walk.info.outputPath(`${name}.png`), clip: { x, y, width, height } });
};

// The page scrolls inside .rack-page, not in the window, so a picture of the whole of it needs a
// window as tall as its contents for a moment.
const tall = async (walk: Walk, body: () => Promise<void>, scroller = '.rack-page') => {
  const view = walk.page.viewportSize()!;
  const height = await walk.page.locator(scroller).first().evaluate(element => element.scrollHeight);
  await walk.page.setViewportSize({ width: view.width, height: Math.min(Math.max(height + 8, view.height), walk.phone ? 6000 : 9000) });
  try {
    await body();
  } finally {
    await walk.page.setViewportSize(view);
  }
};
const whole = (walk: Walk, name: string) => tall(walk, async () => {
  await walk.page.screenshot({ path: walk.info.outputPath(`${name}.png`), fullPage: true, scale: 'css' });
});

// Brings a part to the top of the scrolling page, under the line of the transport that stays.
const toTop = async (walk: Walk, target: Locator, under = 90) => {
  await target.first().evaluate((element, gap) => {
    element.scrollIntoView({ block: 'start' });
    const page = document.querySelector('.rack-page');
    if (page) page.scrollTop = Math.max(0, page.scrollTop - gap);
  }, under);
};
const scrollBy = (walk: Walk, part: number) => walk.page.locator('.rack-page').first().evaluate((element, share) => { element.scrollTop += Math.round(window.innerHeight * share); }, part);

const open = async (page: Page, address = './') => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto(address);
};
const ready = (page: Page) => expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
const menu = async (page: Page, name: 'Project', item?: string) => {
  await more(page);
  await page.getByRole('button', { name: `${name} ▾`, exact: true }).click();
  if (item) await page.getByRole('menuitem', { name: item, exact: true }).click();
};
const lane = (page: Page, id: number) => page.getByRole('region', { name: `Synth ${id} module`, exact: true });
// The open lane's editor has two levels. Notes is the one it opens on; the presets and the pages of the sound are on Sound.
const level = (page: Page, name: 'Notes' | 'Sound') => page.locator('.synth-controls-panel').getByRole('tab', { name, exact: true }).click();

// Some music, so nothing is photographed empty: notes on two lanes, a drum pattern, a second
// scene and a song of two blocks.
const drums = async (walk: Walk) => {
  await attempt(walk, 'seed: a drum pattern', async () => {
    const hits: Array<[string, number[]]> = [['Kick', [1, 5, 9, 13]], ['Snare', [5, 13]], ['Closed Hat', [3, 7, 11, 15]], ['Clap', [13]]];
    for (const [name, steps] of hits) for (const step of steps) await walk.page.getByRole('button', { name: `${name} step ${step}`, exact: true }).click();
  });
};
const seed = async (walk: Walk) => {
  const { page } = walk;
  await attempt(walk, 'seed: notes on lane 1', async () => {
    await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
    const notes: Array<[string, number]> = [['C3', 1], ['G3', 3], ['E3', 5], ['C3', 7], ['G3', 9], ['A3', 11], ['E3', 13], ['G3', 15]];
    for (const [note, step] of notes) await lane(page, 1).getByRole('button', { name: `${note} step ${step}`, exact: true }).click();
  });
  await attempt(walk, 'seed: notes on lane 2', async () => {
    await page.getByRole('button', { name: 'Synth 2', exact: true }).click();
    await lane(page, 2).getByRole('button', { name: 'Piano Roll', exact: true }).click();
    for (const step of [1, 9]) await lane(page, 2).getByRole('button', { name: `C3 step ${step}`, exact: true }).click();
  });
  await attempt(walk, 'seed: back to lane 1', async () => {
    await page.getByRole('button', { name: 'Synth 1', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Synth 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
  await drums(walk);
  await attempt(walk, 'seed: a second scene and a song', async () => {
    await page.getByRole('button', { name: '+ Copy', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Scenes', exact: true }).getByRole('button')).toHaveCount(2);
    await page.getByRole('button', { name: /^\+ Add / }).click();
    await page.getByRole('button', { name: 'More repeats for block 1', exact: true }).click();
    await page.getByRole('group', { name: 'Scenes', exact: true }).getByRole('button').first().click();
    await expect(page.getByRole('group', { name: 'Scenes', exact: true }).getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  });
};

const toneWav = (): Buffer => {
  const rate = 22050, frames = rate / 10, data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + frames * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame += 1) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 880 * frame / rate) * 26000), 44 + frame * 2);
  return data;
};

test('design shots: the rack, its units and the states of its controls', async ({ page }, info) => {
  const walk = begin(page, info);
  await open(page);
  await ready(page);
  await attempt(walk, 'rack-empty', () => shot(walk, 'rack-empty'));
  await seed(walk);
  await attempt(walk, 'rack-full', () => whole(walk, 'rack-full'));

  if (!walk.phone) {
    // Each unit close up, with the window tall enough that nothing is scrolled out of it.
    await attempt(walk, 'units close up', () => tall(walk, async () => {
      const part = async (name: string, target: Locator) => {
        try { await target.first().screenshot({ path: info.outputPath(`${name}.png`) }); } catch (error) { walk.missed.push(`${name}: ${String(error).split('\n')[0].slice(0, 200)}`); }
      };
      await part('unit-transport', page.locator('.rack-unit.transport'));
      await part('unit-song', page.locator('.song-module'));
      await part('unit-synth-piano-roll', lane(page, 1));
      await part('unit-drums', page.locator('[data-unit="drums"]'));
      await part('unit-mixer', page.locator('[data-unit="mixer"]'));
      await part('unit-effects', page.locator('.effects-unit'));
    }));
    await attempt(walk, 'step-tools-selected', async () => {
      await lane(page, 1).getByRole('button', { name: /^Select step 1( |$)/ }).click();
      await near(walk, lane(page, 1).locator('.step-tools'), 'step-tools-selected', 70);
    });
    await attempt(walk, 'unit-keyboard', async () => {
      await lane(page, 1).getByRole('button', { name: 'Keyboard', exact: true }).click();
      await near(walk, lane(page, 1).locator('.keyboard-panel'), 'unit-keyboard', 20);
    });
    await attempt(walk, 'lane-editor-notes', () => near(walk, page.locator('.synth-controls-panel'), 'lane-editor-notes', 12));
    await attempt(walk, 'lane-editor-sound', async () => {
      await level(page, 'Sound');
      await near(walk, page.locator('.synth-controls-panel'), 'lane-editor-sound', 12);
    });
    for (const name of ['Osc', 'Filter', 'LFO', 'Inserts', 'Sends']) {
      await attempt(walk, `synth-tab-${name.toLowerCase()}`, async () => {
        await level(page, 'Sound');
        await lane(page, 1).getByRole('tab', { name, exact: true }).click();
        await near(walk, page.locator('.synth-controls-panel'), `synth-tab-${name.toLowerCase()}`, 12);
      });
    }
    await attempt(walk, 'synth-engine-sample', async () => {
        await level(page, 'Sound');
        await lane(page, 1).getByRole('tab', { name: 'Osc', exact: true }).click();
        const panel = lane(page, 1).locator('.synth-controls-panel');
        await panel.getByLabel('Synth engine', { exact: true }).selectOption('sample');
        await panel.getByLabel('Synth sample', { exact: true }).selectOption('wave:piano');
        await panel.getByLabel('Loop the sample', { exact: true }).check();
        await near(walk, page.locator('.synth-controls-panel'), 'synth-engine-sample', 12);
        await panel.getByLabel('Synth engine', { exact: true }).selectOption('subtractive');
      });
    await attempt(walk, 'back to the notes tab', () => lane(page, 1).getByRole('tab', { name: 'Notes', exact: true }).click());
    await attempt(walk, 'unit-drums-more-sends', async () => {
      const unit = page.locator('[data-unit="drums"]');
      await unit.getByRole('button', { name: 'More', exact: true }).click();
      await unit.getByRole('button', { name: 'Sends', exact: true }).click();
      await tall(walk, () => unit.screenshot({ path: info.outputPath('unit-drums-more-sends.png') }).then(() => {}));
      await unit.getByRole('button', { name: 'More', exact: true }).click();
      await unit.getByRole('button', { name: 'Sends', exact: true }).click();
    });
    await attempt(walk, 'unit-drums-own-sends', async () => {
      const unit = page.locator('[data-unit="drums"]');
      await unit.getByRole('button', { name: 'Sends', exact: true }).click();
      // The selected drum's share of the reverb turned right down, beside the kit's sends.
      const share = unit.locator('.drum-own-sends input').nth(1);
      await share.fill('0%');
      await share.press('Enter');
      await near(walk, unit.locator('.drum-sends'), 'unit-drums-own-sends', 12);
      await share.fill('100%');
      await share.press('Enter');
      await unit.getByRole('button', { name: 'Sends', exact: true }).click();
    });
    await attempt(walk, 'unit-effects-hall', async () => {
      const kind = page.locator('.effects-unit').getByLabel('Reverb kind', { exact: true });
      await kind.selectOption('hall');
      await near(walk, page.locator('.effects-unit .effects-grid'), 'unit-effects-hall', 12);
      await kind.selectOption('room');
    });
  }

  // Focus rings: the first Tab makes the browser show them, and they stay shown for focus moved after.
  await attempt(walk, 'focus-button', async () => {
    await page.locator('.rack-page').first().evaluate((element) => { element.scrollTop = 0; });
    for (let press = 0; press < 3; press += 1) await page.keyboard.press('Tab');
    await near(walk, page.locator(':focus'), 'focus-button', 90);
  });
  await attempt(walk, 'focus-step', async () => {
    const step = lane(page, 1).getByRole('button', { name: /^Select step 3( |$)/ });
    await step.focus();
    await near(walk, step, 'focus-step', 90);
  });
  await attempt(walk, 'focus-knob', async () => {
    const knob = lane(page, 1).getByRole('slider', { name: 'Synth 1 level', exact: true });
    await knob.focus();
    await near(walk, knob, 'focus-knob', 90);
  });
  await attempt(walk, 'focus-unit-help', async () => {
    const help = page.getByRole('button', { name: 'Help for Synth 1', exact: true });
    await help.focus();
    await near(walk, help, 'focus-unit-help', 90);
  });
  // The states beside each other in one row: a mute that is on, a step selected with the pointer,
  // another focused with the keyboard and, where there is a pointer, a third under it.
  const row = (number: number) => lane(page, 1).getByRole('button', { name: new RegExp(`^Select step ${number}( |$)`) });
  await attempt(walk, 'states-step-row', async () => {
    await page.getByRole('button', { name: 'Mute Synth 1', exact: true }).click();
    await row(5).click();
    await page.keyboard.press('Tab');
    await row(3).focus();
    if (!walk.phone) await row(8).hover(); else await page.mouse.move(2, 2);
    await near(walk, lane(page, 1).locator('.step-row'), 'states-step-row', 60);
  });
  await attempt(walk, 'states-step-row-2', async () => {
    await row(5).focus();
    if (!walk.phone) await row(7).hover();
    await near(walk, lane(page, 1).locator('.step-row'), 'states-step-row-2', 60);
  });
  await attempt(walk, 'focus-step-empty', async () => {
    // An empty step selected with the pointer, two along from an empty one focused with the keyboard.
    await row(4).click();
    await page.mouse.move(2, 2);
    await page.keyboard.press('Tab');
    await row(2).focus();
    await near(walk, row(3), 'focus-step-empty', 110);
  });
  await attempt(walk, 'states-song', async () => {
    await page.getByRole('group', { name: 'Scenes', exact: true }).getByRole('button').nth(1).focus();
    await near(walk, page.locator('.song-module'), 'states-song', 10);
  });
  await attempt(walk, 'unit-song-playlist', async () => {
    await page.getByRole('group', { name: 'Song layout', exact: true }).getByRole('button', { name: 'Playlist', exact: true }).click();
    await expect(page.locator('.song-list-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Move row 2 earlier', exact: true }).focus();
    await tall(walk, () => page.locator('.song-module').screenshot({ path: info.outputPath('unit-song-playlist.png') }).then(() => {}));
  });
  await attempt(walk, 'the song as blocks again', () => page.getByRole('group', { name: 'Song layout', exact: true }).getByRole('button', { name: 'Blocks', exact: true }).click());
  await attempt(walk, 'states-drum-grid', async () => {
    await page.getByRole('button', { name: 'Closed Hat step 2', exact: true }).click();
    await page.mouse.move(2, 2);
    await page.keyboard.press('Tab');
    const kick = page.getByRole('button', { name: 'Kick step 1', exact: true });
    await kick.focus();
    await near(walk, kick, 'states-drum-grid', 120);
  });
  await attempt(walk, 'the lane unmuted again', () => page.getByRole('button', { name: 'Mute Synth 1', exact: true }).click());
  await attempt(walk, 'state-disabled-step-tools', async () => {
    await lane(page, 1).getByRole('button', { name: /^Select step 2( |$)/ }).click();
    await expect(lane(page, 1).getByLabel('Step 2 chance', { exact: true })).toBeDisabled();
    await near(walk, lane(page, 1).locator('.step-tools'), 'state-disabled-step-tools', 70);
  });
  if (!walk.phone) {
    await attempt(walk, 'hover-button', async () => {
      const undo = page.getByRole('button', { name: 'Undo', exact: true });
      await undo.hover();
      await near(walk, undo, 'hover-button', 90);
    });
    await attempt(walk, 'hover-step', async () => {
      const step = lane(page, 2).getByRole('button', { name: /^Select step 6( |$)/ });
      await step.hover();
      await near(walk, step, 'hover-step', 90);
    });
  }
  await attempt(walk, 'state-tempo-edit', async () => {
    await page.locator('.rack-page').first().evaluate((element) => { element.scrollTop = 0; });
    await page.locator('.tempo-led').click();
    await near(walk, page.locator('.tempo-led-input'), 'state-tempo-edit', 110);
    await page.keyboard.press('Escape');
  });
  // The rack with the open scene in another time signature: a bar of twelve steps in beats of
  // six, and one of fourteen counted two, two, three. Then back to 4/4 for what follows.
  for (const [signature, name] of [['6/8', 'time-6-8'], ['7/8', 'time-7-8']] as const) {
    await attempt(walk, name, async () => {
      const time = page.locator('.song-module').getByLabel('Time signature of the open scene', { exact: true });
      await time.selectOption(signature);
      await expect(time).toHaveValue(signature);
      await whole(walk, name);
    });
  }
  await attempt(walk, 'time-4-4', async () => {
    await page.locator('.song-module').getByLabel('Time signature of the open scene', { exact: true }).selectOption('4/4');
  });
  await attempt(walk, 'rack-playing', async () => {
    await page.locator('.play-all-button').click();
    await expect(page.locator('.step-light.on').first()).toBeVisible();
    await shot(walk, 'rack-playing');
    await page.locator('.play-all-button').click();
  });
  finish(walk);
});

test('design shots: menus, dialogs, the walkthrough and a guest', async ({ page }, info) => {
  const walk = begin(page, info);
  await open(page);
  await ready(page);
  await drums(walk);

  await attempt(walk, 'menu-project', async () => {
    await menu(page, 'Project');
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    await shot(walk, 'menu-project');
    await page.keyboard.press('Escape');
    await less(page);
  });
  // Export was a menu and is now a dialog; its picture keeps the name it had.
  await attempt(walk, 'menu-export', async () => {
    await more(page);
    await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Export', exact: true })).toBeVisible();
    await shot(walk, 'menu-export');
    await page.keyboard.press('Escape');
  });
  await attempt(walk, 'menu-preset', async () => {
    const editor = page.locator('.synth-module').first();
    await level(page, 'Sound');
    await editor.getByRole('button', { name: /^Synth preset/ }).click();
    await expect(editor.locator('[role="menuitem"][data-group]').first()).toBeVisible();
    await shot(walk, 'menu-preset-groups');
    await editor.locator('[role="menuitem"][data-group="Pad"]').click();
    await expect(editor.getByRole('menu', { name: 'Pad', exact: true })).toBeVisible();
    await shot(walk, 'menu-preset-group-open');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
  await attempt(walk, 'back to the notes', () => level(page, 'Notes'));
  await attempt(walk, 'focus-menu-row', async () => {
    await menu(page, 'Project');
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    await page.keyboard.press('Tab');
    await page.getByRole('menuitem').nth(1).focus();
    if (!walk.phone) await page.getByRole('menuitem').nth(3).hover();
    await near(walk, page.locator('.rack-menu-list'), 'focus-menu-row', 40);
    await page.keyboard.press('Escape');
    await less(page);
  });
  await attempt(walk, 'dialog-help and the walkthrough', async () => {
    await more(page);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'How to use Discobot', exact: true });
    await expect(help).toBeVisible();
    await shot(walk, 'dialog-help');
    await help.getByLabel('Search Help', { exact: true }).fill('kick');
    await expect(help.getByRole('status')).toHaveText('2 of 9 sections match.');
    await shot(walk, 'dialog-help-search');
    await help.getByLabel('Search Help', { exact: true }).fill('zebra');
    await expect(help.getByRole('status')).toContainText('Nothing in Help matches');
    await shot(walk, 'dialog-help-search-nothing');
    await help.getByRole('button', { name: 'Clear search', exact: true }).click();
    await help.getByRole('button', { name: 'Show the Walkthrough', exact: true }).click();
    const tour = page.getByRole('dialog', { name: 'Walkthrough', exact: true });
    for (let stop = 1; stop <= 9; stop += 1) {
      await expect(tour).toContainText(`Step ${stop} of 9`);
      if ([1, 4, 9].includes(stop)) await shot(walk, `walkthrough-step-${stop}`);
      await tour.getByRole('button', { name: stop === 9 ? 'Done' : 'Next', exact: true }).click();
    }
    await expect(tour).toHaveCount(0);
  });
  await attempt(walk, 'dialog-midi-samples', async () => {
    await more(page);
    await page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'MIDI and samples', exact: true })).toBeVisible();
    await shot(walk, 'dialog-midi-samples');
    await page.keyboard.press('Escape');
  });
  await attempt(walk, 'dialog-projects-one', async () => {
    await more(page);
    await page.getByRole('button', { name: /^Project: / }).click();
    await expect(page.getByRole('dialog', { name: 'Projects', exact: true })).toBeVisible();
    await shot(walk, 'dialog-projects-one');
    await page.keyboard.press('Escape');
  });
  await attempt(walk, 'dialog-versions', async () => {
    await menu(page, 'Project', 'Version History');
    await expect(page.getByRole('dialog', { name: 'Version history', exact: true })).toBeVisible();
    await shot(walk, 'dialog-versions');
    await page.keyboard.press('Escape');
  });
  await attempt(walk, 'dialog-share-signed-out', async () => {
    await menu(page, 'Project', 'Share Link');
    await expect(page.getByRole('dialog', { name: 'Share this song', exact: true })).toBeVisible();
    await shot(walk, 'dialog-share-signed-out');
    await page.keyboard.press('Escape');
  });
  await attempt(walk, 'dialog-preset-import', async () => {
    await level(page, 'Sound');
    await page.locator('.synth-module').first().getByLabel('Import synth preset', { exact: true }).setInputFiles({
      name: '1985-1.preset.websynth.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: 'websynth-preset', version: 1, name: '1985-1', params: {
        'voicing.mode': 0, 'osc1.wave': 2, 'osc1.octave': -1, 'osc2.wave': 3, 'osc2.level': 0.5, 'osc1.level': 1, 'sub.level': 0.6,
        'filter.cutoff': 69, 'filter.resonance': 1, 'filter.model': 0, 'filter.envAmount': 30, 'lfo.amount': 0.5, 'lfo.dest': 5, 'fx.reverb.on': 1, 'fx.reverb.mix': 0.4, 'seq.0.len': 16,
      } })),
    });
    await expect(page.getByRole('dialog', { name: 'Preset imported', exact: true })).toBeVisible();
    await shot(walk, 'dialog-preset-import');
    await page.keyboard.press('Escape');
  });
  await attempt(walk, 'back to the notes', () => level(page, 'Notes'));
  await attempt(walk, 'banner-message', async () => {
    await page.getByLabel('Import drum kit files', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a drum') });
    const banner = page.locator('.app-alert').first();
    await expect(banner).toBeVisible();
    await near(walk, banner, 'banner-message', 130);
    await page.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  });
  await attempt(walk, 'dialog-kit-import', async () => {
    const wav = (name: string) => ({ name, mimeType: 'audio/wav', buffer: toneWav() });
    await page.getByLabel('Import drum kit files', { exact: true }).setInputFiles([wav('Kick 01.wav'), wav('Snare.wav'), wav('mystery.wav')]);
    await expect(page.getByRole('dialog', { name: 'Import a drum kit', exact: true })).toBeVisible();
    await shot(walk, 'dialog-kit-import');
    await page.keyboard.press('Escape');
  });
  await attempt(walk, 'dialog-add-guest and unit-guest', async () => {
    await menu(page, 'Project', 'Add Guest Instrument');
    const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
    await expect(dialog).toBeVisible();
    await shot(walk, 'dialog-add-guest');
    const address = dialog.getByLabel('Address of the instrument\'s page', { exact: true });
    await address.fill('https://example.org/synth');
    await near(walk, dialog, 'focus-dialog-field', 10);
    await address.fill('http://example.com/synth');
    await address.press('Enter');
    await expect(dialog.getByRole('alert')).toBeVisible();
    await shot(walk, 'dialog-add-guest-error');
    await address.fill(`${apiUrl(info)}/__guest`);
    await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
    const unit = page.locator('[data-unit="guests"]');
    await expect(unit).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
    await unit.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await shot(walk, 'unit-guest');
  });
  await attempt(walk, 'dialog-projects', async () => {
    await menu(page, 'Project', 'New Project');
    await more(page);
    await page.getByRole('button', { name: /^Project: / }).click();
    const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
    // "Untitled" and "Untitled 2" share a row, with a list to choose between them.
    await expect(projects.getByRole('group')).toHaveCount(1);
    await expect(projects.getByLabel('Version of Untitled', { exact: true }).locator('option')).toHaveCount(2);
    await shot(walk, 'dialog-projects-family');
    await projects.locator('.rack-list-row.current').getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(projects.getByLabel('Project name', { exact: true })).toBeVisible();
    await shot(walk, 'dialog-projects');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
  // Last in this walk: from here on the page has two MIDI inputs.
  await attempt(walk, 'dialog-midi-devices', async () => {
    await page.addInitScript(() => {
      const inputs = [['keys', 'Test keys'], ['pads', 'Test pads']].map(([id, name]) => ({ id, name, state: 'connected', onmidimessage: null }));
      const access = { inputs: new Map(inputs.map(input => [input.id, input])), onstatechange: null };
      Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
    });
    await page.reload();
    await ready(page);
    await more(page);
    await page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'MIDI and samples', exact: true });
    await dialog.getByLabel('Where Test keys is sent', { exact: true }).selectOption('synth:2');
    await dialog.getByLabel('Where Test pads is sent', { exact: true }).selectOption('drums');
    await shot(walk, 'dialog-midi-devices');
    await dialog.getByRole('button', { name: 'Learn a pad for Clap', exact: true }).click();
    await expect(dialog.locator('.midi-pad-status')).toContainText('Clap');
    await dialog.getByRole('button', { name: 'Reset pads', exact: true }).scrollIntoViewIfNeeded();
    await shot(walk, 'dialog-midi-pads');
    await page.keyboard.press('Escape');
  });
  finish(walk);
});

test('design shots: a phone showing one unit at a time, the knob sheet, and a phone on its side', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-chromium', 'this is the narrow layout');
  const walk = begin(page, info);
  await open(page);
  await ready(page);
  await seed(walk);
  await page.evaluate((key) => { window.dispatchEvent(new Event('pagehide')); localStorage.removeItem(key); }, UNIT_KEY);
  await page.reload();
  await ready(page);
  const bar = page.getByRole('navigation', { name: 'Rack units', exact: true });
  const show = async (name: string | RegExp) => {
    await bar.getByRole('button', { name, exact: true }).tap();
    await expect(bar.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'true');
  };

  await attempt(walk, 'phone-unit-song', async () => { await show('Show Song'); await shot(walk, 'phone-unit-song'); });
  await attempt(walk, 'phone-unit-synth', async () => {
    await show('Show Synth 1');
    await shot(walk, 'phone-unit-synth');
    await scrollBy(walk, 0.7);
    await shot(walk, 'phone-unit-synth-2');
  });
  await attempt(walk, 'phone-piano-roll', async () => {
    await toTop(walk, lane(page, 1).locator('.keyboard-panel'));
    await shot(walk, 'phone-piano-roll');
  });
  await attempt(walk, 'phone-keyboard', async () => {
    await lane(page, 1).getByRole('button', { name: 'Keyboard', exact: true }).tap();
    await expect(lane(page, 1).getByRole('button', { name: 'Higher keys', exact: true })).toBeVisible();
    await toTop(walk, lane(page, 1).locator('.keyboard-panel'));
    await shot(walk, 'phone-keyboard');
  });
  await attempt(walk, 'phone-lane-editor-notes', async () => {
    await toTop(walk, page.locator('.synth-controls-panel'));
    await shot(walk, 'phone-lane-editor-notes');
  });
  await attempt(walk, 'phone-lane-editor-sound', async () => {
    await level(page, 'Sound');
    await toTop(walk, page.locator('.synth-controls-panel'));
    await shot(walk, 'phone-lane-editor-sound');
  });
  for (const name of ['Osc', 'Filter', 'Inserts', 'Sends']) {
    await attempt(walk, `phone-synth-tab-${name.toLowerCase()}`, async () => {
      await level(page, 'Sound');
      await lane(page, 1).getByRole('tab', { name, exact: true }).click();
      await toTop(walk, page.locator('.synth-controls-panel'));
      await shot(walk, `phone-synth-tab-${name.toLowerCase()}`);
    });
  }
  await attempt(walk, 'phone-synth-engine-sample', async () => {
      await level(page, 'Sound');
      await lane(page, 1).getByRole('tab', { name: 'Osc', exact: true }).click();
      const panel = lane(page, 1).locator('.synth-controls-panel');
      await panel.getByLabel('Synth engine', { exact: true }).selectOption('sample');
      await panel.getByLabel('Synth sample', { exact: true }).selectOption('wave:piano');
      await panel.getByLabel('Loop the sample', { exact: true }).check();
    await toTop(walk, panel.getByLabel('Synth sample', { exact: true }));
    await shot(walk, 'phone-synth-engine-sample');
      await panel.getByLabel('Synth engine', { exact: true }).selectOption('subtractive');
  });
  await attempt(walk, 'back to the notes tab', () => lane(page, 1).getByRole('tab', { name: 'Notes', exact: true }).click());
  await attempt(walk, 'phone-knob-sheet', async () => {
    await page.locator('.rack-page').first().evaluate((element) => { element.scrollTop = 0; });
    await page.locator('[data-unit="synth-1"]').getByRole('slider', { name: 'Synth 1 level', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: 'Synth 1 level', exact: true });
    await expect(sheet).toBeVisible();
    await shot(walk, 'phone-knob-sheet');
    await sheet.getByRole('button', { name: 'Close Synth 1 level', exact: true }).tap();
    await expect(sheet).toHaveCount(0);
  });
  await attempt(walk, 'phone-unit-synth-empty', async () => {
    await show(/^Show Synth 3/);
    await shot(walk, 'phone-unit-synth-3');
  });
  await attempt(walk, 'phone-unit-drums', async () => {
    await show('Show Drums');
    await shot(walk, 'phone-unit-drums');
    await scrollBy(walk, 0.7);
    await shot(walk, 'phone-unit-drums-2');
  });
  await attempt(walk, 'phone-unit-drums-sends', async () => {
    const unit = page.locator('[data-unit="drums"]');
    await unit.getByRole('button', { name: 'Sends', exact: true }).tap();
    await toTop(walk, unit.locator('.drum-sends'));
    await shot(walk, 'phone-unit-drums-sends');
    await unit.getByRole('button', { name: 'Sends', exact: true }).tap();
  });
  await attempt(walk, 'phone-unit-mixer', async () => {
    await show('Show Mixer');
    await shot(walk, 'phone-unit-mixer');
    await page.locator('.mixer-desk').evaluate((desk) => { desk.scrollLeft = desk.scrollWidth; });
    await shot(walk, 'phone-unit-mixer-2');
  });
  await attempt(walk, 'phone-unit-effects', async () => {
    await show('Show Effects');
    await shot(walk, 'phone-unit-effects');
    await scrollBy(walk, 0.7);
    await shot(walk, 'phone-unit-effects-2');
  });
  await attempt(walk, 'phone-unit-effects-hall', async () => {
    await show('Show Effects');
    const kind = page.locator('.effects-unit').getByLabel('Reverb kind', { exact: true });
    await kind.selectOption('hall');
    await toTop(walk, page.locator('.effects-unit .effects-block').filter({ has: kind }));
    await shot(walk, 'phone-unit-effects-hall');
    await kind.selectOption('room');
  });
  // The sheet the top bar's last button raises, and the Project menu from inside it.
  await attempt(walk, 'phone-more-sheet', async () => {
    await show('Show Synth 1');
    await more(page);
    const sheet = page.getByRole('dialog', { name: 'More controls', exact: true });
    await expect(sheet).toBeVisible();
    await shot(walk, 'phone-more-sheet');
    await sheet.getByRole('button', { name: 'Project ▾', exact: true }).click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    await shot(walk, 'phone-more-sheet-menu');
    await page.keyboard.press('Escape');
    await less(page);
    await expect(sheet).toHaveCount(0);
  });
  // The bar of units with a lane muted from it, still and while playing, when the lamps of the
  // units that sound are lit on their steps.
  await attempt(walk, 'phone-unit-bar-muted', async () => {
    await show('Show Drums');
    await bar.getByRole('button', { name: 'Show Synth 2', exact: true }).focus();
    await page.keyboard.press('Shift+M');
    await expect(bar.getByRole('button', { name: 'Show Synth 2', exact: true })).toHaveAttribute('data-muted', 'true');
    await shot(walk, 'phone-unit-bar-muted');
    await page.locator('.play-all-button').click();
    await expect(bar.locator('.unit-tab-led.lit').first()).toBeVisible();
    await shot(walk, 'phone-unit-bar-playing');
    await page.locator('.play-all-button').click();
    await bar.getByRole('button', { name: 'Show Synth 2', exact: true }).focus();
    await page.keyboard.press('Shift+M');
    await expect(bar.locator('[data-muted]')).toHaveCount(0);
  });
  await attempt(walk, 'phone-unit-all', async () => { await show('Show all units on one page'); await shot(walk, 'phone-unit-all'); });

  // A phone on its side.
  const upright = page.viewportSize()!;
  await attempt(walk, 'phone-landscape', async () => {
    await page.setViewportSize({ width: 740, height: 360 });
    await show('Show Synth 1');
    await shot(walk, 'phone-landscape-synth');
    await more(page);
    await expect(page.getByRole('dialog', { name: 'More controls', exact: true })).toBeVisible();
    await shot(walk, 'phone-landscape-more-sheet');
    await less(page);
    await toTop(walk, lane(page, 1).locator('.keyboard-panel'), 50);
    await shot(walk, 'phone-landscape-keyboard');
    await show('Show Drums');
    await shot(walk, 'phone-landscape-drums');
  });
  await page.setViewportSize(upright);
  finish(walk);
});

test('design shots: an account, sharing, a published song and a person\'s page', async ({ page, request }, info) => {
  const walk = begin(page, info);
  await request.post(`${apiUrl(info)}/__reset`);
  await open(page);
  await ready(page);
  await drums(walk);
  const account = page.getByRole('dialog', { name: 'Account', exact: true });
  let long = '', short = '', own = '';

  await attempt(walk, 'dialog-account', async () => {
    await more(page);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(account).toBeVisible();
    await shot(walk, 'dialog-account-signed-out');
    await account.getByRole('tab', { name: 'Create Account', exact: true }).click();
    await account.getByLabel('Username', { exact: true }).fill('Ian');
    await account.getByLabel('Password', { exact: true }).fill('password123');
    await account.getByLabel('Invite code', { exact: true }).fill('browser-test-owner');
    await account.getByRole('button', { name: 'Create Account', exact: true }).last().click();
    await expect(account.getByRole('alert')).toBeVisible();
    await shot(walk, 'dialog-account-create-error');
    await account.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await account.getByLabel('Password', { exact: true }).press('Enter');
    await expect(account.getByLabel('Your new recovery code', { exact: true })).toHaveText(/^(\w{5}-){4}\w{5}$/);
    await shot(walk, 'dialog-account-recovery-code');
    await account.getByRole('checkbox').check();
    await account.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(account).toContainText('Signed in as Ian');
    await account.getByRole('button', { name: 'New Invite Code', exact: true }).click();
    await shot(walk, 'dialog-account-signed-in');
    await page.keyboard.press('Escape');
    await expect(account).toHaveCount(0);
  });
  await attempt(walk, 'transport-signed-in', async () => {
    await more(page);
    await expect(page.getByRole('button', { name: 'Account: Ian', exact: true })).toBeVisible();
    await shot(walk, 'transport-signed-in');
    await less(page);
  });
  await attempt(walk, 'dialog-projects-signed-in', async () => {
    await more(page);
    await page.getByRole('button', { name: /^Project: / }).click();
    const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
    await projects.locator('.rack-list-row.current').getByRole('button', { name: 'Rename', exact: true }).click();
    await projects.getByLabel('Project name', { exact: true }).fill('Friday Night');
    await projects.getByLabel('Project name', { exact: true }).press('Enter');
    await expect(projects.getByRole('group', { name: 'Project Friday Night', exact: true })).toBeVisible();
    await shot(walk, 'dialog-projects-signed-in');
    await page.keyboard.press('Escape');
  });
  await attempt(walk, 'dialog-share', async () => {
    await menu(page, 'Project', 'Share Link');
    const share = page.getByRole('dialog', { name: 'Share this song', exact: true });
    await expect(share.getByRole('button', { name: 'Publish and Get a Short Link', exact: true })).toBeVisible();
    await shot(walk, 'dialog-share-signed-in');
    long = await share.getByLabel('Share link', { exact: true }).inputValue();
    await share.getByRole('button', { name: 'Publish and Get a Short Link', exact: true }).click();
    await expect(share.getByLabel('Short link', { exact: true })).toHaveValue(/#s=[a-z0-9]{10}$/);
    short = await share.getByLabel('Short link', { exact: true }).inputValue();
    own = await share.getByLabel('Your songs page', { exact: true }).inputValue();
    await shot(walk, 'dialog-share-published');
    await page.keyboard.press('Escape');
  });

  // The pages a link opens, each in a tab of its own, as a link would be opened.
  const visit = async (name: string, address: string, seen: (visitor: Page) => Promise<void>) => {
    await attempt(walk, name, async () => {
      if (!address) throw new Error('there was no link to open');
      const visitor = await page.context().newPage();
      visitor.setDefaultTimeout(6_000);
      try {
        await visitor.goto(address);
        await seen(visitor);
        await shot(walk, name, visitor);
      } finally {
        await visitor.close();
      }
    });
  };
  await visit('page-share', short, async (visitor) => {
    await expect(visitor.getByRole('main', { name: 'Shared song', exact: true })).toBeVisible();
    await expect(visitor.getByRole('button', { name: /Listen/ })).toBeVisible();
  });
  await visit('page-share-playing', short, async (visitor) => {
    await visitor.getByRole('button', { name: /Listen/ }).click();
    await expect(visitor.locator('audio')).toBeAttached({ timeout: 40_000 });
  });
  await visit('page-share-long-link', long, async (visitor) => {
    await expect(visitor.getByRole('main', { name: 'Shared song', exact: true })).toBeVisible();
  });
  await visit('page-share-error', './#s=aaaaaaaaaa', async (visitor) => {
    await expect(visitor.getByRole('heading', { name: 'This link could not be opened', exact: true })).toBeVisible();
  });
  await visit('page-user-songs', own, async (visitor) => {
    await expect(visitor.getByRole('main', { name: 'Published songs', exact: true }).getByRole('link').first()).toBeVisible();
  });
  await visit('page-user-songs-empty', './#u=Nobody', async (visitor) => {
    await expect(visitor.getByRole('main', { name: 'Published songs', exact: true })).toBeVisible();
    await expect(visitor.getByRole('main', { name: 'Published songs', exact: true })).toContainText(/\S/);
  });
  finish(walk);
});

test('design shots: kids mode, both screens', async ({ page }, info) => {
  const walk = begin(page, info);
  await open(page, './#kids');
  const kids = page.getByRole('main', { name: 'Kids mode', exact: true });
  await expect(kids).toBeVisible();
  await attempt(walk, 'kids-pads', () => shot(walk, 'kids-pads'));
  await attempt(walk, 'kids-pads-playing', async () => {
    for (const pad of ['Bear', 'Cat', 'Chick', 'Drum']) await kids.getByRole('group', { name: 'Pads', exact: true }).getByRole('button', { name: pad, exact: true }).click();
    await kids.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(kids.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await shot(walk, 'kids-pads-playing');
  });
  await attempt(walk, 'kids-beat', async () => {
    await kids.getByRole('button', { name: 'Build a beat', exact: true }).click();
    await expect(kids.getByRole('group', { name: 'Beat', exact: true })).toBeVisible();
    await shot(walk, 'kids-beat');
  });
  await attempt(walk, 'kids stop', () => kids.getByRole('button', { name: 'Stop', exact: true }).click());
  await attempt(walk, 'kids-leave-holding', async () => {
    const leave = kids.getByRole('button', { name: 'Leave kids mode: press and hold for three seconds', exact: true });
    await leave.hover();
    await page.mouse.down();
    // Part of the way through the three seconds, which is the state to be seen; nothing is read after it.
    await page.waitForTimeout(1_400);
    await near(walk, leave, 'kids-leave-holding', 140);
    await page.mouse.up();
  });
  if (walk.phone) {
    const upright = page.viewportSize()!;
    await attempt(walk, 'kids-landscape', async () => {
      await page.setViewportSize({ width: 740, height: 360 });
      await shot(walk, 'kids-beat-landscape');
      await kids.getByRole('button', { name: 'Play the pads', exact: true }).click();
      await expect(kids.getByRole('group', { name: 'Pads', exact: true })).toBeVisible();
      await shot(walk, 'kids-pads-landscape');
    });
    await page.setViewportSize(upright);
  }
  finish(walk);
});

test('design shots: automation under a lane\'s steps', async ({ page }, info) => {
  const walk = begin(page, info);
  await open(page);
  await ready(page);
  const row = lane(page, 1).locator('.auto-row');
  await attempt(walk, 'automation-empty', () => near(walk, row, 'automation-empty', 40));
  await attempt(walk, 'automation-sweep', async () => {
    await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
    for (const step of [1, 5, 9, 13]) await lane(page, 1).getByRole('button', { name: `C3 step ${step}`, exact: true }).click();
    await lane(page, 1).getByLabel('Synth 1 automation parameter', { exact: true }).selectOption('cutoff');
    const cell = (step: number) => lane(page, 1).getByRole('slider', { name: `Cutoff automation, step ${step}`, exact: true });
    await cell(1).scrollIntoViewIfNeeded();
    const start = (await cell(1).boundingBox())!, end = (await cell(12).boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height * 0.85);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height * 0.1, { steps: 16 });
    await page.mouse.up();
    await cell(6).focus();
    await near(walk, lane(page, 1).locator('.rack-row').first(), 'automation-sweep', 20);
    if (!walk.phone) await tall(walk, () => lane(page, 1).screenshot({ path: info.outputPath('automation-lane.png') }).then(() => {}));
  });
  await attempt(walk, 'automation-auto-on', async () => {
    await lane(page, 1).getByRole('button', { name: 'Record automation', exact: true }).click();
    await lane(page, 1).getByRole('button', { name: 'Erase automation steps', exact: true }).focus();
    await near(walk, row, 'automation-auto-on', 40);
  });
  finish(walk);
});
