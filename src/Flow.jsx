import React from 'react';
import flowData from '../data/flows.json';
import Stepper from './Stepper';

export const flowByCard = Object.fromEntries(flowData.flows.flatMap(flow => flow.cards.map(id => [id, flow])));

// A keyed journey resets page-memory answers and checkboxes when cards change.
// Stepper also handles cards with no authored decision flow.
export default function Flow({ flow, card, onTrail }) {
  return <Stepper key={`${flow?.id || 'official'}-${card?.id || ''}`} flow={flow} card={card} onTrail={onTrail}/>;
}
