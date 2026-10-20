import type { ProjectInfo } from './projectLibrary';

// The endings the app itself puts on a project's name. `localService` and `projectSync`
// build their names from these, so the Projects list can tell which projects belong together.
export const COPY_SUFFIX = ' copy';
export const EARLIER_SUFFIX = ' (earlier version)';
export const KEPT_SUFFIX = ' (this browser\'s version)';
// What a new project is called. Two new projects are "Untitled" and "Untitled 2", which are not
// related: the number on this name is part of a project's own name, not an ending of the family's.
export const DEFAULT_PROJECT_NAME = 'Untitled';
// `uniqueName` counts from 2 and never writes a leading zero.
const NUMBER_SUFFIX = / (?:[2-9]|[1-9]\d+)$/;

export interface FamilyMember {
  project: ProjectInfo;
  // What sets this one apart from the rest of its family: "Original", "copy", "2".
  label: string;
}
export interface ProjectFamily {
  key: string;
  // The name the row is headed by: the shared name, or a lone project's own name in full.
  title: string;
  members: FamilyMember[];
}

// The name with one generated ending taken off, or null when it has none. What is left must be
// a name the app could have started from: not empty, and not ending in a space.
function withoutEnding(name: string): string | null {
  const fixed = [COPY_SUFFIX, EARLIER_SUFFIX, KEPT_SUFFIX].find(suffix => name.endsWith(suffix));
  const length = fixed ? fixed.length : NUMBER_SUFFIX.exec(name)?.[0].length;
  if (!length) return null;
  const rest = name.slice(0, -length);
  return rest && rest === rest.trimEnd() ? rest : null;
}

// The name a project's family goes by: its own name with every generated ending removed, so
// "Song copy 2" and "Song (this browser's version)" both belong to "Song".
export function familyName(name: string): string {
  let base = name;
  for (let rest = withoutEnding(base); rest !== null; rest = withoutEnding(base)) {
    if (rest.toLowerCase() === DEFAULT_PROJECT_NAME.toLowerCase() && NUMBER_SUFFIX.test(base)) break;
    base = rest;
  }
  return base;
}

// Projects grouped into families, in the order the first of each family appears. Within a
// family the one with the plain name comes first and the rest keep their order.
export function projectFamilies(projects: ProjectInfo[]): ProjectFamily[] {
  const families = new Map<string, { base: string; projects: ProjectInfo[] }>();
  for (const project of projects) {
    const base = familyName(project.name), key = base.toLowerCase();
    const family = families.get(key) ?? { base, projects: [] };
    families.set(key, family);
    // The original's own spelling heads the row when it is there.
    if (project.name.toLowerCase() === key) { family.base = project.name; family.projects.unshift(project); } else family.projects.push(project);
  }
  return [...families].map(([key, { base, projects: found }]) => ({
    key,
    title: found.length === 1 ? found[0].name : base,
    members: found.map(project => ({
      project,
      label: project.name.length === base.length ? 'Original' : project.name.slice(base.length).replace(/[()]/g, '').trim(),
    })),
  }));
}

// The member a family's row acts on: the one picked, else the open project, else the one
// changed last.
export function chosenMember(family: ProjectFamily, pickedId: string | undefined, openId: string): ProjectInfo {
  const all = family.members.map(member => member.project);
  return all.find(project => project.id === pickedId) ?? all.find(project => project.id === openId)
    ?? all.reduce((latest, project) => (project.updatedAt > latest.updatedAt ? project : latest));
}
