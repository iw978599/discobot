import type { ReactNode } from 'react';
import { createDefaultSynthParameters } from '@discobot/engine';
import type { Studio } from '../studio/useStudio';
import { tracked } from '../studio/tracked';
import { DRUM_ROW_NAMES, DRUM_SETTINGS_DEFAULT, EXTRA_ROW_SETTINGS } from '../services/drumKits';
import { EFFECTS_DEFAULT } from '../services/effectSettings';
import { AUX_KIND_DEFAULT, AUX_KIND_LABELS, AUX_NAMES } from '../services/auxSettings';
import { panText, parsePan, parsePercent, percentText, type MixerChannels } from '../services/mixerChannels';
import UnitFold, { useFolded } from './UnitFold';
import Fader from '../components/Fader';
import { useHandOvers } from '../hooks/useHandedTo';
import Knob from '../components/Knob';
import UnitHelp, { UNIT_HELP } from './UnitHelp';
import Scope from '../components/Scope';
import { dragClass, useDragOrder } from './useDragOrder';
import type { DrumInstrument, DrumRow } from '../types';
import { TRACK_VOLUME } from '../services/audioTracks';

const SOUND_DEFAULTS = createDefaultSynthParameters();
const laneParsePan = (input: string) => parsePan(input, 'lane');
const drumParsePan = (input: string) => parsePan(input, 'drum');

interface StripProps {
  // What every control on the strip is called, after "Mixer": "Synth 1", "Kick", "guest Pocket Mouse".
  about: string;
  name: string;
  under?: string;
  drum?: DrumRow;
  // The guest this channel's voice is handed to, if any: it is not in the mix but heard through the guest.
  handedTo?: string;
  // `word` is what the fader sets, where the strip's name does not already say: "level", "volume".
  level: { word?: string; value: number; max?: number; home: number; hint: string; onChange: (value: number) => void };
  pan?: { value: number; kind: 'lane' | 'drum'; onChange: (value: number) => void };
  muted?: boolean;
  solo?: boolean;
  onMute?: () => void;
  onSolo?: () => void;
}

// One channel: its name, a pan knob if it has a pan, the fader, and mute and solo if it has them.
// A part a channel does not have keeps its room, so the faders stand in one line across the desk.
function Strip({ about, name, under, drum, handedTo, level, pan, muted, solo, onMute, onSolo }: StripProps) {
  const caption = handedTo ? `→ ${handedTo}` : under;
  return (
    <div className="mixer-strip" role="group" aria-label={`Mixer ${about}`} data-drum={drum} data-muted={muted ? 'true' : undefined} data-handed={handedTo ? 'true' : undefined}>
      <div className="mixer-name">
        <b>{name}</b>
        {caption && <span title={handedTo ? `Sent to the guest ${handedTo}, and heard through it` : caption}>{caption}</span>}
      </div>
      <div className="mixer-pan">
        {pan && (
          <Knob
            size="small"
            label="Pan"
            ariaLabel={`Mixer ${about} pan`}
            min={-1}
            max={1}
            value={pan.value}
            defaultValue={0}
            displayValue={panText(pan.value, pan.kind)}
            parseInputValue={pan.kind === 'lane' ? laneParsePan : drumParsePan}
            onChange={pan.onChange}
            tooltip="Left, centre or right"
          />
        )}
      </div>
      <Fader
        name={level.word ? `Mixer ${about} ${level.word}` : `Mixer ${about}`}
        value={level.value}
        defaultValue={level.home}
        max={level.max ?? 1}
        displayValue={percentText(level.value)}
        parseInputValue={parsePercent}
        onChange={level.onChange}
        hint={level.hint}
      />
      <div className="mixer-ms">
        {onMute && <button className={`rack-btn ${muted ? 'on' : ''}`} aria-label={`Mixer ${about} mute`} aria-pressed={Boolean(muted)} title="Mute" onClick={onMute}>M</button>}
        {onSolo && <button className={`rack-btn ${solo ? 'on' : ''}`} aria-label={`Mixer ${about} solo`} aria-pressed={Boolean(solo)} title="Solo" onClick={onSolo}>S</button>}
      </div>
    </div>
  );
}

function Group({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <div className="mixer-group" role="group" aria-label={`Mixer ${name}`}>
      <div className="mixer-group-name"><b>{name}</b>{note && <span>{note}</span>}</div>
      <div className="mixer-strips">{children}</div>
    </div>
  );
}

// Every level the project has, side by side. Nothing here is kept by the mixer: each control is
// a second view of one that is in a unit of its own, changed through that one's handler, so the
// two always read the same and an edit here is undone, saved and heard as an edit there is.
// `channels` is handed in already gathered (mixerChannels) and stays the same object while none of
// those levels change, so the mixer is not drawn again for a note or a step.
function MixerModule({ studio, channels, onHelp }: { studio: Studio; channels: MixerChannels; onHelp?: (section: string) => void }) {
  const hidden = useFolded('mixer');
  const handed = useHandOvers();
  const { lanes, drums, guests, tracks, returns } = channels;
  // A lane's strip dragged to another's place moves the lane there on the rack too (roadmap 20).
  const laneOrder = useDragOrder('mixer-lanes', (from, to) => { void studio.handleLaneMove(lanes[from].id, lanes[to].id); }, false, '.mixer-name');

  return (
    <section className="rack-unit mixer-unit" aria-label="Mixer module" data-unit="mixer" data-folded={hidden ? 'true' : undefined}>
      <div className="rack-row">
        <div className={onHelp ? 'rack-plate static helped' : 'rack-plate static'}>
          <b>Mixer</b>
          <span>Every level</span>
          {onHelp && <UnitHelp about="the mixer" section={UNIT_HELP.mixer} onHelp={onHelp} />}
          <UnitFold unit="mixer" about="the mixer" />
        </div>
        {!hidden && <span className="rack-hint">Each fader is the same control as the knob in its own unit: move either and both move.</span>}
      </div>
      {!hidden && (
        <div className="mixer-desk">
          <Group name="Synths">
            {lanes.map((lane, index) => (
              <div key={lane.id} className={`mixer-slot ${dragClass(laneOrder.dragging, index)}`} {...laneOrder.item(index, lanes.length)}>
              <Strip
                key={lane.id}
                about={`Synth ${lane.id}`}
                name={lane.name}
                under={lane.model}
                handedTo={handed[`synth:${lane.id}`]}
                level={{ word: 'level', value: lane.level, max: 2, home: SOUND_DEFAULTS.gain, hint: 'How loud this lane is. The same as its Level knob', onChange: (value) => { void studio.handleParameterChange(lane.id, { gain: value }); } }}
                pan={{ value: lane.pan, kind: 'lane', onChange: (value) => { void studio.handleParameterChange(lane.id, { pan: value }); } }}
                muted={lane.muted}
                solo={lane.solo}
                onMute={() => { void studio.handleSynthMixChange(lane.id, { muted: !lane.muted }); }}
                onSolo={() => { void studio.handleSynthMixChange(lane.id, { solo: !lane.solo }); }}
              />
              </div>
            ))}
          </Group>
          {guests.length > 0 && (
            <Group name="Guests" note="Kept with each scene">
              {guests.map(guest => (
                <Strip
                  key={guest.id}
                  about={`guest ${guest.name}`}
                  name="Guest"
                  under={guest.name}
                  level={{ word: 'level', value: guest.volume, home: 0.8, hint: 'How loud this guest is in the open scene. A guest has a level and a mute for each scene', onChange: (value) => { void studio.handleGuestChange(guest.id, { volume: value }); } }}
                  muted={guest.muted}
                  onMute={() => { void studio.handleGuestChange(guest.id, { muted: !guest.muted }); }}
                />
              ))}
            </Group>
          )}
          {tracks.length > 0 && (
            <Group name="Audio" note="Tracks on the timeline">
              {tracks.map(track => (
                <Strip
                  key={track.id}
                  about={`audio ${track.name}`}
                  name="Audio"
                  under={track.name}
                  level={{ word: 'level', value: track.volume, home: TRACK_VOLUME, hint: 'How loud this audio track is', onChange: (value) => studio.handleTrackChange(track.id, { volume: value }) }}
                  pan={{ value: track.pan, kind: 'lane', onChange: (value) => studio.handleTrackChange(track.id, { pan: value }) }}
                  muted={track.muted}
                  solo={track.solo}
                  onMute={() => studio.handleTrackChange(track.id, { muted: !track.muted })}
                  onSolo={() => studio.handleTrackChange(track.id, { solo: !track.solo })}
                />
              ))}
            </Group>
          )}
          <Group name="Drums">
            {drums.map(drum => (
              <Strip
                key={drum.id}
                about={DRUM_ROW_NAMES[drum.id]}
                name={DRUM_ROW_NAMES[drum.id]}
                drum={drum.id}
                handedTo={handed[`drum:${drum.id}`]}
                level={{ word: 'volume', value: drum.volume, home: (drum.id in DRUM_SETTINGS_DEFAULT ? DRUM_SETTINGS_DEFAULT[drum.id as DrumInstrument] : EXTRA_ROW_SETTINGS).volume, hint: 'How loud this drum is. The same as its Volume knob', onChange: value => studio.handleDrumSettingsChange(drum.id, { volume: value }) }}
                pan={{ value: drum.pan, kind: 'drum', onChange: value => studio.handleDrumSettingsChange(drum.id, { pan: value }) }}
                muted={drum.muted}
                solo={drum.solo}
                onMute={() => studio.handleDrumMixChange(drum.id, { muted: !drum.muted })}
                onSolo={() => studio.handleDrumMixChange(drum.id, { solo: !drum.solo })}
              />
            ))}
            <Strip
              about="Drums master"
              name="All"
              under="Drums"
              handedTo={handed.drums}
              level={{ word: 'volume', value: channels.drumMaster, home: 1, hint: 'Level of the whole drum kit. The same as the Master knob on the drums', onChange: studio.handleDrumMasterVolumeChange }}
            />
          </Group>
          <Group name="Effects">
            <Strip
              about="Synth return"
              name="Synth"
              under="Return"
              level={{ value: returns.synth, home: EFFECTS_DEFAULT.returns.synth, hint: 'How much of the shared effects the synths get back', onChange: value => studio.handleEffectsLoopChange({ returns: { ...returns, synth: value } }) }}
            />
            <Strip
              about="Drum return"
              name="Drum"
              under="Return"
              level={{ value: returns.drums, home: EFFECTS_DEFAULT.returns.drums, hint: 'How much of the shared effects the drums get back', onChange: value => studio.handleEffectsLoopChange({ returns: { ...returns, drums: value } }) }}
            />
            {channels.aux.map((bus, slot) => (
              <Strip
                key={AUX_NAMES[slot]}
                about={`Aux ${AUX_NAMES[slot]} return`}
                name={`Aux ${AUX_NAMES[slot]}`}
                under={AUX_KIND_LABELS[bus.kind]}
                level={{ value: bus.level, home: AUX_KIND_DEFAULT[bus.kind].level, hint: `How loud aux bus ${AUX_NAMES[slot]} comes back. The same as its Level knob in the effects`, onChange: value => studio.handleEffectsLoopChange({ aux: channels.aux.map((entry, index) => (index === slot ? { ...entry, level: value } : entry)) }) }}
              />
            ))}
          </Group>
          <Group name="Main" note="This browser">
            <Strip
              about="main"
              name="Volume"
              level={{ word: 'volume', value: channels.main, home: 1, hint: 'Output volume for this browser tab. It is this browser’s, not the project’s: it is not saved, shared or exported', onChange: studio.setBrowserVolume }}
            />
            <div className="mixer-picture">
              <Scope label="Mixer main" source={() => studio.soundAnalyser('master')} />
            </div>
          </Group>
        </div>
      )}
    </section>
  );
}

export default tracked(MixerModule, 'mixer');
