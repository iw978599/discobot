import { useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { FEATURED_GUESTS, MAX_GUESTS } from '../services/guests';
import Dialog from './Dialog';

// Adds another creator's instrument by the address of its page.
export default function AddGuestDialog({ studio, onClose }: { studio: Studio; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const full = studio.guests.length >= MAX_GUESTS;
  const add = async (address = url) => {
    const problem = await studio.handleAddGuest(address);
    if (problem) setError(problem); else onClose();
  };
  return (
    <Dialog title="Add a guest instrument" closeLabel="Close guest instrument" onClose={onClose}>
      <p>
        A guest instrument is another creator's web instrument, shown inside this project. It follows Discobot's tempo and play button,
        and its sound goes through the mixer. Its settings are saved with the project.
      </p>
      <h3>Instruments to try</h3>
      {FEATURED_GUESTS.map(guest => {
        const added = studio.guests.some(entry => entry.url === guest.url);
        return (
          <div key={guest.url} className="rack-list-row" role="group" aria-label={`${guest.name} by ${guest.by}`}>
            <span>
              <strong>{guest.name}</strong>
              <small>{guest.about} · by {guest.by}</small>
            </span>
            <button className="rack-btn" disabled={full || added} onClick={() => { void add(guest.url); }}>{added ? 'Added' : 'Add'}</button>
          </div>
        );
      })}
      <h3>Another instrument</h3>
      <form className="account-form" onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <div className="account-field">
          <label htmlFor="guest-address">Address of the instrument's page</label>
          <input id="guest-address" type="url" value={url} placeholder="https://" autoCapitalize="none" spellCheck={false} disabled={full} onChange={(event) => setUrl(event.target.value)} />
          <small>The creator's page has to support Discobot guests. Pages that do not will still show, but will not follow the tempo.</small>
        </div>
        {error && <p role="alert">{error}</p>}
        {full && <p role="alert">This project already has {MAX_GUESTS} guest instruments.</p>}
        <div className="rack-dialog-actions start">
          <button className="rack-btn go" type="submit" disabled={full || !url.trim()}>Add Guest</button>
        </div>
      </form>
      <p className="rack-empty">
        Adding a guest opens that site's page inside Discobot, so your browser contacts that site whenever this project is open.
        The page cannot read your projects or your account. Its settings are saved with the project. Its sound is recorded into Download WAV and Song WAV by playing through once.
      </p>
    </Dialog>
  );
}
