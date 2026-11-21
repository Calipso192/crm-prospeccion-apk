import { DEFAULT_CAMPAIGN_ID, normalizePhone, normalizeInstagram } from './lead-schema.js';
import { saveJsonFileToDevice } from './backup-service.js';
import { DEDUPE_INDEX_FILENAME } from './blap-sync-service.js';

function resolveLeadStage(lead, activeCampaignId) {
  if (lead && lead.campaignStates && activeCampaignId && lead.campaignStates[activeCampaignId]) {
    const cs = lead.campaignStates[activeCampaignId];
    return cs && cs.stage ? String(cs.stage) : 'nuevo';
  }
  if (lead && lead.stage) { return String(lead.stage); }
  if (lead && lead.status) { return String(lead.status); }
  return 'nuevo';
}

export function buildDedupeIndexPayload(leads, activeCampaignId) {
  const list = Array.isArray(leads) ? leads : [];
  const targetCid = activeCampaignId ? String(activeCampaignId) : DEFAULT_CAMPAIGN_ID;
  const entries = [];

  list.forEach((lead) => {
    if (!lead || typeof lead !== 'object') { return; }
    const phone = normalizePhone(lead.phone);
    const instagram = normalizeInstagram(lead.instagram);
    const name = lead.name ? String(lead.name).trim() : '';
    if (!phone && !instagram && !name) { return; }
    entries.push({
      phone: phone,
      instagram: instagram,
      name: name,
      stage: resolveLeadStage(lead, targetCid)
    });
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    activeCampaignId: targetCid,
    count: entries.length,
    leads: entries
  };
}

export async function downloadDedupeIndexFile(leads, activeCampaignId) {
  const payload = buildDedupeIndexPayload(leads, activeCampaignId);
  const jsonString = JSON.stringify(payload);
  const res = await saveJsonFileToDevice(DEDUPE_INDEX_FILENAME, jsonString, { subFolder: '' });
  return Object.assign({}, res, {
    count: payload.count,
    bytes: jsonString.length
  });
}
