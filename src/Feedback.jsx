import React, { useState } from 'react';
import { API_BASE } from './search';
import { SEARCH_MODE } from './PrivateMode';

const ISSUES_URL = 'https://github.com/fuellabs-ai/hobbyindia/issues/new';

// Local mode (Plan B): there is no server, so feedback is a prefilled GitHub issue that
// carries the card id only - never the question. Server mode (Plan C): card id + vote only.
export default function Feedback({ cardId, privateMode }) {
  const [sent, setSent] = useState(null);
  if (SEARCH_MODE !== 'server') {
    return <div className="feedback">
      <a className="link" href={`${ISSUES_URL}?title=${encodeURIComponent(`Wrong card: ${cardId}`)}&body=${encodeURIComponent(`Card: \`${cardId}\``)}`} target="_blank" rel="noopener noreferrer">Report a wrong card</a>
      <small>Opens GitHub. Sends the card name only, never your question.</small>
    </div>;
  }
  async function send(vote) {
    setSent(vote);
    try { await fetch(`${API_BASE}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card: cardId, vote }) }); } catch { /* feedback is best-effort */ }
  }
  if (sent) return <p className="feedback done" role="status">{sent === 'wrong' ? 'Thanks. We’ll review this card.' : 'Thanks for telling us.'}</p>;
  return <div className="feedback">
    <span>Right answer?</span>
    <button onClick={() => send('yes')}>Yes</button>
    <button onClick={() => send('no')}>No</button>
    <button className="link" onClick={() => send('wrong')}>Report a wrong card</button>
    <small>{privateMode ? 'Sends only the card name and your answer, never your question.' : 'We save only the card name and your answer, never your question.'}</small>
  </div>;
}
