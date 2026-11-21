import {
  getAllLeads,
  mergeImportedLeads,
  updateLeadCampaignStage,
  toggleInterestTag,
  updateLeadReminder,
  updateLeadSuggestedMessage,
  addQuickNoteToLead,
  normalizePhone,
  normalizeInstagram
} from './db-service.js';
import { getActiveCampaignId, setActiveCampaign, getCampaigns, mergeCampaigns, mergeTemplates } from './template-service.js';
import { getInterestTagsCatalog, mergeInterestTagsCatalog } from './phase-engine.js';
import { mergeChannelStats } from './channel-service.js';

function formatPatchNoteDate(dateObj) {
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return [
    dateObj.getFullYear(),
    pad(dateObj.getMonth() + 1),
    pad(dateObj.getDate())
  ].join('-') + ' ' + pad(dateObj.getHours()) + ':' + pad(dateObj.getMinutes());
}

function buildLeadLookup(leads) {
  const byId = new Map();
  const byPhone = new Map();
  const byInstagram = new Map();

  (Array.isArray(leads) ? leads : []).forEach((lead) => {
    if (!lead || !lead.id) { return; }
    byId.set(String(lead.id), lead);
    const phone = normalizePhone(lead.phone);
    if (phone && !byPhone.has(phone)) { byPhone.set(phone, lead); }
    const ig = normalizeInstagram(lead.instagram);
    if (ig && !byInstagram.has(ig)) { byInstagram.set(ig, lead); }
  });

  return { byId: byId, byPhone: byPhone, byInstagram: byInstagram };
}

function findMatchingLead(patch, lookup) {
  if (!patch || typeof patch !== 'object') { return null; }
  if (patch.id && lookup.byId.has(String(patch.id))) {
    return lookup.byId.get(String(patch.id));
  }
  const phone = normalizePhone(patch.phone || patch.telefono || '');
  if (phone && lookup.byPhone.has(phone)) {
    return lookup.byPhone.get(phone);
  }
  const ig = normalizeInstagram(patch.instagram || patch.ig || '');
  if (ig && lookup.byInstagram.has(ig)) {
    return lookup.byInstagram.get(ig);
  }
  return null;
}

function resolveInterestTagObject(rawTag, catalog) {
  if (!rawTag) { return null; }
  if (typeof rawTag === 'object' && rawTag.id) {
    return { id: String(rawTag.id), label: String(rawTag.label || rawTag.id).trim() };
  }
  const needle = String(rawTag).trim();
  if (!needle) { return null; }
  const lower = needle.toLowerCase();
  const found = catalog.find((t) => t.id.toLowerCase() === lower || t.label.toLowerCase() === lower);
  if (found) {
    return { id: found.id, label: found.label };
  }
  return { id: 'int_' + lower.replace(/[^a-z0-9]+/g, '_'), label: needle };
}

async function applyStandardBackupFormat(parsed) {
  const campStats = mergeCampaigns(Array.isArray(parsed.campaigns) ? parsed.campaigns : [], parsed.activeCampaignId || '');
  const tplStats = mergeTemplates(Array.isArray(parsed.templates) ? parsed.templates : []);
  const intStats = mergeInterestTagsCatalog(
    Array.isArray(parsed.interestTagsCatalog) ? parsed.interestTagsCatalog : [],
    Array.isArray(parsed.leads) ? parsed.leads : []
  );
  if (parsed.channelStats && typeof parsed.channelStats === 'object') {
    mergeChannelStats(parsed.channelStats);
  }
  const knownCampaignIds = getCampaigns().map((c) => c.id);
  const mergeStats = await mergeImportedLeads(Array.isArray(parsed.leads) ? parsed.leads : [], {
    defaultCampaignId: getActiveCampaignId(),
    knownCampaignIds: knownCampaignIds
  });
  const totalChanges = mergeStats.added + mergeStats.updated + campStats.added + tplStats.added + tplStats.updated + intStats.added + intStats.updated;
  return {
    format: 'backup',
    added: mergeStats.added,
    updated: mergeStats.updated,
    skipped: 0,
    totalChanges: totalChanges
  };
}

async function applyPatchItem(lead, patch, activeCid, catalog) {
  let modified = false;
  const cs = lead.campaignStates && lead.campaignStates[activeCid] ? lead.campaignStates[activeCid] : null;

  if (patch.stage) {
    const extra = patch.saleAmount !== undefined ? { saleAmount: patch.saleAmount } : undefined;
    await updateLeadCampaignStage(lead.id, activeCid, patch.stage, extra);
    modified = true;
  } else if (patch.saleAmount !== undefined && cs) {
    await updateLeadCampaignStage(lead.id, activeCid, cs.stage || 'ganado', { saleAmount: patch.saleAmount });
    modified = true;
  }

  if (Array.isArray(patch.interestTags)) {
    const existingIds = new Set(cs && Array.isArray(cs.interestTags) ? cs.interestTags.map((t) => t.id) : []);
    for (let i = 0; i < patch.interestTags.length; i += 1) {
      const tagObj = resolveInterestTagObject(patch.interestTags[i], catalog);
      if (tagObj && !existingIds.has(tagObj.id)) {
        await toggleInterestTag(lead.id, activeCid, tagObj);
        existingIds.add(tagObj.id);
        modified = true;
      }
    }
  }

  if (patch.reminderAt !== undefined || patch.reminderReason !== undefined) {
    const nextAt = patch.reminderAt !== undefined ? patch.reminderAt : (cs ? cs.reminderAt : '');
    const nextReason = patch.reminderReason !== undefined ? patch.reminderReason : (cs ? cs.reminderReason : '');
    await updateLeadReminder(lead.id, activeCid, nextAt, nextReason);
    modified = true;
  }

  if (patch.suggestedMessage !== undefined) {
    await updateLeadSuggestedMessage(lead.id, activeCid, patch.suggestedMessage);
    modified = true;
  }

  if (patch.note && String(patch.note).trim()) {
    const stamp = formatPatchNoteDate(new Date());
    const formatted = '[' + stamp + '] ' + String(patch.note).trim();
    await addQuickNoteToLead(lead.id, activeCid, formatted);
    modified = true;
  }

  return modified;
}

export async function applyJarvisPatchPayload(rawText) {
  if (!rawText || !String(rawText).trim()) {
    return { format: 'empty', added: 0, updated: 0, skipped: 0, totalChanges: 0 };
  }
  let parsed;
  try {
    parsed = JSON.parse(String(rawText).trim());
  } catch (err) {
    throw new Error('El archivo jarvis_crm_patch.json no contiene un JSON válido.');
  }

  let forceBackup = Boolean(parsed && parsed.force_backup === true);
  let campaignChanged = false;
  if (parsed && parsed.activeCampaignId && setActiveCampaign(String(parsed.activeCampaignId))) {
    campaignChanged = true;
  }

  const patchesList = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.patches) ? parsed.patches : null);

  if (!patchesList && parsed && Array.isArray(parsed.leads)) {
    const res = await applyStandardBackupFormat(parsed);
    return { ...res, forceBackup, campaignChanged };
  }

  if (!patchesList && forceBackup) {
    return { format: 'patches', added: 0, updated: 0, skipped: 0, totalChanges: 0, forceBackup: true, campaignChanged };
  }

  if (!patchesList) {
    throw new Error('Formato de parche no reconocido. Usa { leads: [...] } o { patches: [...] }.');
  }

  const leads = await getAllLeads();
  const lookup = buildLeadLookup(leads);
  const catalog = getInterestTagsCatalog();

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < patchesList.length; i += 1) {
    const patch = patchesList[i];
    if (patch && patch.force_backup === true) { forceBackup = true; }
    if (patch && patch.activeCampaignId && setActiveCampaign(String(patch.activeCampaignId))) {
      campaignChanged = true;
    }
    const targetLead = findMatchingLead(patch, lookup);
    if (!targetLead) {
      if (!(patch && (patch.force_backup === true || patch.activeCampaignId))) { skipped += 1; }
      continue;
    }
    const targetCid = patch.campaignId ? String(patch.campaignId) : getActiveCampaignId();
    const didChange = await applyPatchItem(targetLead, patch, targetCid, catalog);
    if (didChange) {
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    format: 'patches',
    added: 0,
    updated: updated,
    skipped: skipped,
    totalChanges: updated,
    forceBackup,
    campaignChanged
  };
}
