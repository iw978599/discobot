import { useMemo, useSyncExternalStore, type CSSProperties } from 'react';
import { liveStatus, subscribeLive } from '../services/liveSession';
import { initials } from '../services/deskSong';

// The other people in a live session: each one's name, colour and the unit they were last at, as text
// so the store's snapshot is the same until it changes.
export type Person = [user: string, colour: number, at: string];
export const livePeople = () => {
  const status = liveStatus();
  return status.state === 'live' ? JSON.stringify(status.others.map((member): Person => [member.user, member.colour, member.at ?? ''])) : '[]';
};

export const parsePeople = (text: string) => JSON.parse(text) as Person[];

// The desk's top bar shows who else is in the live session as their initials, each in their colour.
// It reads the session itself, so it renders for the people and for nothing else.
export default function DeskPeople() {
  const text = useSyncExternalStore(subscribeLive, livePeople);
  const people = useMemo(() => parsePeople(text), [text]);
  if (people.length === 0) return null;
  return (
    <span className="desk-people" role="group" aria-label="People in this live session">
      {people.map(([user, colour]) => (
        <span key={user} className="desk-person" role="img" aria-label={user} title={user} style={{ '--present': `var(--person-${colour})` } as CSSProperties}>{initials(user)}</span>
      ))}
    </span>
  );
}
