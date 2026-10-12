import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { SCENE_COLORS, nextSceneColor, sceneColor } from '../src/services/sceneColors.ts';
import { sceneBar } from '../src/services/patternLength.ts';
import { defaults, setup } from './helpers/store.ts';

const fresh = () => {
  setup();
  const service = new LocalProjectService();
  service.initialize(defaults());
  return service;
};
const colours = (service: LocalProjectService) => service.snapshot().scenes.map(scene => scene.color);
const scenesIn = (file: any): any[] => file.scenes ?? file.project?.scenes ?? file.state?.scenes;

test('a new scene takes the first colour no scene has, and they come round again', () => {
  assert.equal(nextSceneColor([]), SCENE_COLORS[0]);
  assert.equal(nextSceneColor([{ color: SCENE_COLORS[0] }, {}]), SCENE_COLORS[1]);
  assert.equal(nextSceneColor([{ color: SCENE_COLORS[1] }]), SCENE_COLORS[0]);
  const all = SCENE_COLORS.map(color => ({ color }));
  assert.ok(sceneColor(nextSceneColor(all)), 'still a colour once every one is taken');
  assert.equal(sceneColor('amber'), undefined);
  assert.equal(sceneColor(7), undefined);
});

test('a scene keeps its colour while it is edited, left and come back to', () => {
  const service = fresh();
  const first = service.snapshot().currentSceneId;
  assert.deepEqual(colours(service), [undefined], 'the scene a project starts with has none, as before');
  const made = service.createScene();
  assert.ok(made.ok);
  const second = service.snapshot().currentSceneId;
  assert.ok(service.setSceneColor(first, 'blue').ok);
  assert.ok(service.setDrumStep('kick', 3, true).ok);
  assert.ok(service.selectScene(first).ok);
  assert.ok(service.setDrumStep('kick', 5, true).ok);
  assert.ok(service.selectScene(second).ok);
  assert.deepEqual(colours(service), ['blue', 'red']);
  assert.equal(sceneBar(service.snapshot().scenes[0], 0).color, 'blue', 'a bar cut from a scene carries its colour');
});

test('colours travel in a project file, and a file is not trusted about them', async () => {
  const service = fresh();
  const first = service.snapshot().currentSceneId;
  assert.ok(service.createScene().ok);
  assert.ok(service.setSceneColor(first, 'violet').ok);
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  assert.deepEqual(scenesIn(file).map(scene => scene.color), ['violet', 'red']);

  const read = fresh().readProjectFile(JSON.parse(JSON.stringify(file)));
  assert.ok(read.ok);
  if (read.ok) assert.deepEqual(read.project.scenes.map(scene => scene.color), ['violet', 'red']);

  const hostile = JSON.parse(JSON.stringify(file));
  scenesIn(hostile)[0].color = 'url(javascript:alert(1))';
  scenesIn(hostile)[1].color = 7;
  const bounded = fresh().readProjectFile(hostile);
  assert.ok(bounded.ok);
  if (bounded.ok) for (const scene of bounded.project.scenes) assert.equal('color' in scene, false);
});

test('a project saved before scenes had colours opens as it was', async () => {
  const service = fresh();
  assert.ok(service.createScene().ok);
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  for (const scene of scenesIn(file)) delete scene.color;
  const target = fresh();
  assert.deepEqual(await target.importProject(JSON.parse(JSON.stringify(file))), { ok: true, repaired: false });
  assert.deepEqual(colours(target), [undefined, undefined]);
  assert.deepEqual(JSON.parse(JSON.stringify(target.snapshot().scenes)), scenesIn(file));
});
