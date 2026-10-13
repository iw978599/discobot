export interface HelpSection {
  id: string;
  title: string;
  text: string;
}

const plain = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

export const helpWords = (query: string) => plain(query).split(' ').filter(Boolean);

// The sections a search leaves on show, in their own order: every word typed must be somewhere
// in the section, in its heading or its text, in any order. Nothing typed leaves them all.
export function matchHelp(sections: readonly HelpSection[], query: string): string[] {
  const words = helpWords(query);
  return sections
    .filter((section) => {
      const text = plain(`${section.title} ${section.text}`);
      return words.every((word) => text.includes(word));
    })
    .map((section) => section.id);
}

export function helpCount(shown: number, total: number, query: string): string {
  const typed = query.trim();
  if (!typed) return '';
  if (shown === 0) return `Nothing in Help matches “${typed}”.`;
  return shown === 1 ? `1 of ${total} sections matches.` : `${shown} of ${total} sections match.`;
}
