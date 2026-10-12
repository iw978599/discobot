import type { Scene } from '../types';

// The colours a scene can be given, so a song's shape can be read from its blocks: A A B A.
// A scene holds one of these names or nothing. rack.css has the colour each name is drawn in;
// none of them is the amber that means "on".
export const SCENE_COLORS = ['red', 'green', 'blue', 'teal', 'violet', 'pink'] as const;
export type SceneColor = typeof SCENE_COLORS[number];

export const SCENE_COLOR_NAMES: Record<SceneColor, string> = {
  red: 'Red', green: 'Green', blue: 'Blue', teal: 'Teal', violet: 'Violet', pink: 'Pink',
};

export const sceneColor = (value: unknown): SceneColor | undefined => SCENE_COLORS.find(color => color === value);

// The colour a new scene starts with: the first one no other scene has, or the next in turn
// once all of them are taken.
export function nextSceneColor(scenes: Array<Pick<Scene, 'color'>>): SceneColor {
  const taken = new Set(scenes.map(scene => scene.color));
  return SCENE_COLORS.find(color => !taken.has(color)) ?? SCENE_COLORS[scenes.length % SCENE_COLORS.length];
}
