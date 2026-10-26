// Guest instruments and samples: adding, removing and changing a guest, and loading the samples
// the drum lanes and the synth lanes play. Split out of useStudio.tsx.
import { useCallback, useEffect } from 'react';
import type { DrumRow } from '../types';
import { localService } from '../services/localService';
import type { GuestPatch } from '../services/projectOps';
import { loadDrumSample } from '../services/drumSamples';
import { loadCymbals, loadLaneSample } from '../services/builtInWaves';
import { drumRowsOf } from '../services/drumKits';
import type { DrumSample } from '../../../engine/src/drums/DrumCore';
import { guestOrigin, guestUrl, trustOrigin } from '../services/guests';
import type { StudioCore } from './useStudioCore';

export function useStudioGuests(core: StudioCore) {
  const { drumState, drumStateRef, drumSamplesRef, drumAudio, setMissingDrumSamples, sampleStoreVersion, cymbalsRef, synths, synthsRef, synthSamplesRef, synthAudio } = core;
  // Adds another creator's instrument by its address. Typing it in is the user's say-so to load that site.
  const handleAddGuest = useCallback(async (url: string): Promise<string | null> => {
    // Recorded first: the unit appears as soon as the store accepts the guest, and must not ask again.
    const address = guestUrl(url, window.location.origin);
    if (address) trustOrigin(guestOrigin(address));
    const result = localService.addGuest(url);
    return result.ok ? null : result.error;
  }, []);
  const handleRemoveGuest = useCallback(async (id: string) => { localService.removeGuest(id); }, []);
  const handleGuestChange = useCallback(async (id: string, patch: GuestPatch) => { localService.changeGuest(id, patch); }, []);
  // Which sample each drum lane uses, as one string, so the effect below only runs when that changes.
  const drumSampleKey = drumRowsOf(drumState).map(instrument => `${instrument}:${drumState[instrument]?.sampleId ?? ''}`).join('|');
  useEffect(() => {
    let current = true;
    void Promise.all(drumRowsOf(drumStateRef.current).map(async (instrument) => {
      const id = drumStateRef.current[instrument]?.sampleId;
      return [instrument, id ? await loadDrumSample(id) : null, Boolean(id)] as const;
    })).then((loaded) => {
      if (!current) return;
      const next: Partial<Record<DrumRow, DrumSample>> = {};
      for (const [instrument, sample] of loaded) {
        if (sample) next[instrument] = sample;
        if (sample !== (drumSamplesRef.current[instrument] ?? null)) drumAudio.setSample(instrument, sample);
      }
      drumSamplesRef.current = next;
      setMissingDrumSamples(loaded.filter(([, sample, wanted]) => wanted && !sample).map(([instrument]) => instrument));
    });
    return () => { current = false; };
  }, [drumSampleKey, drumAudio, sampleStoreVersion]);
  // The cymbals come with the app. Until they arrive the cymbal lane plays its synthesized voice.
  useEffect(() => {
    let current = true;
    void loadCymbals().then((cymbals) => {
      if (!current) return;
      cymbalsRef.current = cymbals;
      drumAudio.setCymbals(cymbals);
    });
    return () => { current = false; };
  }, [drumAudio]);
  // The same for the synth lanes: which recording each one's sample engine plays.
  const synthSampleKey = synths.map(entry => `${entry.id}:${entry.synthParams?.sample?.wave ?? ''}:${entry.synthParams?.sample?.id ?? ''}`).join('|');
  useEffect(() => {
    let current = true;
    void Promise.all(synthsRef.current.map(async (entry) => {
      return [entry.id, await loadLaneSample(entry.synthParams)] as const;
    })).then((loaded) => {
      if (!current) return;
      const next: Record<number, DrumSample> = {};
      for (const [laneId, sample] of loaded) {
        if (sample) next[laneId] = sample;
        if (sample !== (synthSamplesRef.current[laneId] ?? null)) synthAudio.setSample(laneId, sample);
      }
      // A lane that has gone gives its recording back, so a lane added later under its number starts with none.
      for (const laneId of Object.keys(synthSamplesRef.current).map(Number)) {
        if (!loaded.some(([present]) => present === laneId)) synthAudio.setSample(laneId, null);
      }
      synthSamplesRef.current = next;
    });
    return () => { current = false; };
  }, [synthSampleKey, synthAudio, sampleStoreVersion]);
  const handleDrumSampleChange = useCallback(async (instrument: DrumRow, sampleId: string | null) => {
    localService.setDrumSample(instrument, sampleId ?? undefined);
  }, []);
  return { handleAddGuest, handleRemoveGuest, handleGuestChange, handleDrumSampleChange };
}
