// A controller's sustain pedal (MIDI CC 64), as on a piano: while it is down, a key let go keeps
// sounding until the pedal comes up. Each controller has a pedal of its own. Keys are whatever the
// caller holds a played note under (`midiHeldRef`'s keys), so a kept note is let go the usual way,
// through `handleNoteRelease`, which is also what keeps an arpeggio running while the pedal is down.

export const SUSTAIN_PEDAL = 64;
// A pedal sends 0 to 127; from the middle up it is down, as the MIDI specification says.
export const pedalDown = (value: number) => value >= 64;

export class MidiSustain {
  private down = new Set<string>();
  private kept = new Map<string, Set<string>>();

  // The pedal moved. Coming up, it answers the keys to let go now.
  pedal(device: string, isDown: boolean): string[] {
    if (isDown) { this.down.add(device); return []; }
    this.down.delete(device);
    return this.take(device);
  }

  // A key was let go: true when the pedal keeps it sounding, to be let go when the pedal comes up.
  keep(device: string, key: string): boolean {
    if (!this.down.has(device)) return false;
    const kept = this.kept.get(device) ?? new Set<string>();
    kept.add(key);
    this.kept.set(device, kept);
    return true;
  }

  // A key was played: true when the pedal was keeping it, so the note it kept is let go first.
  struck(device: string, key: string): boolean {
    return this.kept.get(device)?.delete(key) ?? false;
  }

  // The controller is gone: its pedal is up, and every key it kept is answered to be let go.
  forget(device: string): string[] {
    this.down.delete(device);
    return this.take(device);
  }

  private take(device: string): string[] {
    const keys = [...(this.kept.get(device) ?? [])];
    this.kept.delete(device);
    return keys;
  }
}
