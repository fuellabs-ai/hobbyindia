// Which authored scenario, if any, a question belongs to. Deliberately narrow:
// anything that isn't a prepared CPGRAMS or RTI case is reported as not covered.
// The same patterns drive the trace's word highlighting, so what lights up is
// exactly what the matcher keyed on.
export const PATTERNS = {
  rti: /\brti\b|right to information/,
  grievance: /grievance|cpgrams|pgportal|public grievance|complaint/,
  closure: /clos|resolv|disposed|feedback|appeal/,
  state: /\bstate\b|state government|state department|\but\b|union territory/,
  central: /central/,
  remains: /remain|still|not (been )?(resolved|fixed|solved|addressed)|nothing changed|unresolved|persist|feedback|appeal|rated|poor/,
  details: /detail|reason|reply|correspond|letter|by post|postal|copy of|why (was|it)/,
};

export function matchScenario(text) {
  const q = text.toLowerCase();
  if (PATTERNS.rti.test(q)) return 'rti';
  if (!PATTERNS.grievance.test(q) || !PATTERNS.closure.test(q)) return 'not_covered';
  if (PATTERNS.state.test(q) && !PATTERNS.central.test(q)) return 'state';
  const remains = PATTERNS.remains.test(q);
  const details = PATTERNS.details.test(q);
  if (remains && !details) return 'scenario';
  if (details && !remains) return 'details';
  return 'which_case';
}

// Single-word view of the same pattern groups, for showing which words fed which group.
export const WORD_GROUPS = {
  rti: /^(rti|information)$/,
  grievance: /^(grievance|cpgrams|pgportal|complaint)/,
  closure: /^(clos|resolv|disposed|feedback|appeal)/,
  state: /^(state|ut)$/,
  central: /^central$/,
  remains: /^(remain|still|unresolved|persist|feedback|appeal|rated|poor|nothing|changed)/,
  details: /^(detail|reason|reply|correspond|letter|post|postal)/,
};
export const wordGroups = word => Object.keys(WORD_GROUPS).filter(key => WORD_GROUPS[key].test(word.toLowerCase()));
export const isMatcherWord = word => wordGroups(word).length > 0;
export const firedGroups = text => Object.keys(PATTERNS).filter(key => PATTERNS[key].test(text.toLowerCase()));
