import React, { useState } from 'react';
import { API_BASE } from './search';

// Sends only the card id and the answer: never the question.
export default function Feedback({ cardId, privateMode }) {
  const [sent, setSent] = useState(null);
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
