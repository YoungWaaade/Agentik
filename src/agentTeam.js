// Who leads the agent team: the coordinator flag (`manager` in the agent file) wins,
// otherwise the agent whose id is "nami". Never based on list order.
export const LEAD_SLUG = 'nami';

export function splitAgents(agents = []) {
  const flagged = agents.filter((a) => a.manager && a.manager !== 'false');
  const lead = flagged[0] || agents.find((a) => a.slug === LEAD_SLUG) || null;
  return { lead, others: agents.filter((a) => a !== lead) };
}
