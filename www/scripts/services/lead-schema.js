import {
  normalizeScore,
  normalizeContactMethod,
  normalizeRubro,
  dedupeQuickNotes
} from './lead-enrich-schema.js';

export const DEFAULT_COUNTRY_CODE = '51';
export const DEFAULT_CAMPAIGN_ID = 'camp_default';
export const SCHEMA_VERSION_V4 = 4;

const VALID_STAGES = ['nuevo', 'contactado', 'seguimiento', 'vendido', 'descartado', 'sin_whatsapp'];
const VALID_CHANNELS = ['whatsapp', 'instagram', 'llamada'];
const VALID_WA_LINES = ['wa_1', 'wa_2', 'wa_3'];

export function normalizePhone(rawPhone) {
  if (!rawPhone) { return ''; }
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) {
    return DEFAULT_COUNTRY_CODE + digits;
  }
  return digits;
}

export function normalizeInstagram(rawIg) {
  if (!rawIg) { return ''; }
  let clean = String(rawIg).trim().toLowerCase();
  clean = clean.replace(/^https?:\/\//, '');
  clean = clean.replace(/^www\./, '');
  clean = clean.replace(/^instagram\.com\//, '');
  clean = clean.replace(/^instagr\.am\//, '');
  clean = clean.split('?')[0].split('#')[0];
  clean = clean.replace(/^[@/]+/, '').split('/')[0];
  clean = clean.replace(/[^a-z0-9._]/g, '');
  return clean.length >= 2 ? clean : '';
}

export function normalizeChannel(rawChannel) {
  if (!rawChannel) { return ''; }
  const clean = String(rawChannel).trim().toLowerCase();
  return VALID_CHANNELS.includes(clean) ? clean : '';
}

export function normalizeWaLine(rawLine) {
  if (!rawLine) { return ''; }
  const clean = String(rawLine).trim().toLowerCase();
  return VALID_WA_LINES.includes(clean) ? clean : '';
}

export function parseSaleAmount(rawAmount) {
  const parsed = Number(rawAmount);
  if (Number.isNaN(parsed)) { return 0; }
  return parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

export function normalizeStatus(rawStatus) {
  if (!rawStatus) { return 'nuevo'; }
  const mapped = rawStatus === 'cerrado' ? 'vendido' : String(rawStatus).trim().toLowerCase();
  return VALID_STAGES.includes(mapped) ? mapped : 'nuevo';
}

export function buildSentTagEntry(tagData, sentTimestamp) {
  const entry = {
    id: String(tagData.id),
    label: tagData.label ? String(tagData.label).trim() : String(tagData.id),
    sentAt: sentTimestamp
  };
  if (tagData.phase !== undefined && tagData.phase !== null) {
    const cleanPhase = Number(tagData.phase);
    entry.phase = [1, 2, 3].includes(cleanPhase) ? cleanPhase : 0;
  }
  return entry;
}

export function normalizeTagList(rawTags, timeField) {
  if (!Array.isArray(rawTags)) { return []; }
  const cleanList = [];
  rawTags.forEach((item) => {
    if (!(item && item.id)) { return; }
    const ts = Number(item[timeField]) > 0 ? Number(item[timeField]) : Date.now();
    if (timeField === 'sentAt') {
      cleanList.push(buildSentTagEntry(item, ts));
    } else {
      cleanList.push({
        id: String(item.id),
        label: item.label ? String(item.label).trim() : String(item.id),
        [timeField]: ts
      });
    }
  });
  return cleanList;
}

export function normalizeQuickNotes(rawNotes) {
  if (!Array.isArray(rawNotes)) { return []; }
  const cleanList = [];
  rawNotes.forEach((item, idx) => {
    if (item && item.text) {
      const cleanText = String(item.text).trim();
      if (!cleanText) { return; }
      cleanList.push({
        id: item.id
          ? String(item.id)
          : 'note_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).slice(2, 6),
        text: cleanText,
        createdAt: Number(item.createdAt) > 0 ? Number(item.createdAt) : Date.now()
      });
    }
  });
  return dedupeQuickNotes(cleanList);
}

export function computeLastContactAt(record, sentTags) {
  let latest = record && Number(record.lastContactAt) > 0 ? Number(record.lastContactAt) : 0;
  if (Array.isArray(sentTags)) {
    sentTags.forEach((tag) => {
      if (Number(tag.sentAt) > latest) { latest = Number(tag.sentAt); }
    });
  }
  if (latest > 0) { return latest; }
  if (record && Number(record.updatedAt) > 0) { return Number(record.updatedAt); }
  return Date.now();
}

export function createDefaultCampaignState(stage, now) {
  const ts = Number(now) > 0 ? Number(now) : Date.now();
  return {
    stage: normalizeStatus(stage),
    channelUsed: '',
    contactMethod: '',
    score: null,
    waLineUsed: '',
    isMetaBot: false,
    sentTags: [],
    interestTags: [],
    quickNotes: [],
    reminderAt: '',
    reminderReason: '',
    suggestedMessage: '',
    saleAmount: 0,
    lastContactAt: ts,
    updatedAt: ts
  };
}

export function normalizeCampaignState(rawState, fallbackNow) {
  const src = rawState && typeof rawState === 'object' ? rawState : {};
  const ts = Number(fallbackNow) > 0 ? Number(fallbackNow) : Date.now();
  const cleanStage = normalizeStatus(src.stage !== undefined ? src.stage : src.status);
  const sentTags = normalizeTagList(src.sentTags, 'sentAt');
  const updatedAt = Number(src.updatedAt) > 0 ? Number(src.updatedAt) : ts;
  const rawMethod = src.contactMethod !== undefined ? src.contactMethod : (src.contact_method !== undefined ? src.contact_method : src.recommendedChannel);
  return {
    stage: cleanStage,
    channelUsed: normalizeChannel(src.channelUsed),
    contactMethod: normalizeContactMethod(rawMethod),
    score: normalizeScore(src.score),
    waLineUsed: normalizeWaLine(src.waLineUsed),
    isMetaBot: cleanStage === 'descartado' ? Boolean(src.isMetaBot) : false,
    sentTags: sentTags,
    interestTags: normalizeTagList(src.interestTags, 'taggedAt'),
    quickNotes: normalizeQuickNotes(src.quickNotes),
    reminderAt: src.reminderAt ? String(src.reminderAt).trim() : '',
    reminderReason: src.reminderReason ? String(src.reminderReason).trim() : '',
    suggestedMessage: src.suggestedMessage ? String(src.suggestedMessage).trim() : '',
    saleAmount: cleanStage === 'vendido' ? parseSaleAmount(src.saleAmount) : 0,
    lastContactAt: computeLastContactAt({ lastContactAt: src.lastContactAt, updatedAt: updatedAt }, sentTags),
    updatedAt: updatedAt
  };
}

export function applySentTagToCampaignState(campState, tagData, sentTs, preserveRecentContact) {
  const hasTags = Array.isArray(campState.sentTags) && campState.sentTags.length > 0;
  const hasNotes = Array.isArray(campState.quickNotes) && campState.quickNotes.length > 0;
  const hasInt = Array.isArray(campState.interestTags) && campState.interestTags.length > 0;
  const hadPrior = [hasTags, hasNotes, hasInt].some(Boolean);
  const nextTags = (Array.isArray(campState.sentTags) ? campState.sentTags : []).filter((item) => item.id !== tagData.id);
  nextTags.push(buildSentTagEntry(tagData, sentTs));
  campState.sentTags = nextTags;
  const prevContact = Number(campState.lastContactAt) > 0 ? Number(campState.lastContactAt) : 0;
  campState.lastContactAt = (preserveRecentContact && hadPrior) ? Math.max(prevContact, sentTs) : sentTs;
}

export const applySentTagToLead = applySentTagToCampaignState;

export function needsV4Migration(raw) {
  if (!(raw && typeof raw === 'object')) { return true; }
  if (Number(raw.schemaVersion) !== SCHEMA_VERSION_V4) { return true; }
  if (!(raw.campaignStates && typeof raw.campaignStates === 'object' && !Array.isArray(raw.campaignStates))) {
    return true;
  }
  return Object.keys(raw.campaignStates).length === 0;
}

function resolveTargetCampaignForLegacy(src, fallbackCampaignId, options) {
  const fallback = fallbackCampaignId ? String(fallbackCampaignId).trim() : DEFAULT_CAMPAIGN_ID;
  if (options && options.forceFallbackForLegacy) { return fallback; }
  const srcCamp = src.campaignId ? String(src.campaignId).trim() : '';
  if (!srcCamp) { return fallback; }
  if (options && Array.isArray(options.knownCampaignIds)) {
    return options.knownCampaignIds.includes(srcCamp) ? srcCamp : fallback;
  }
  return srcCamp;
}

function hydrateLegacyHistoryIntoStates(history, campaignStates, fallbackNow) {
  if (!Array.isArray(history)) { return; }
  history.forEach((entry) => {
    if (!(entry && typeof entry === 'object' && entry.campaignId)) { return; }
    const cid = String(entry.campaignId).trim();
    if (!cid) { return; }
    if (campaignStates[cid]) { return; }
    const entryTs = Number(entry.archivedAt) > 0 ? Number(entry.archivedAt) : fallbackNow;
    campaignStates[cid] = normalizeCampaignState({
      stage: entry.status,
      saleAmount: entry.saleAmount,
      sentTags: entry.sentTags,
      interestTags: entry.interestTags,
      quickNotes: entry.quickNotes,
      updatedAt: entryTs,
      lastContactAt: entryTs
    }, entryTs);
  });
}

export function normalizeMasterRecord(record, fallbackCampaignId, options) {
  const src = record && typeof record === 'object' ? record : {};
  const now = Date.now();
  const createdAt = Number(src.createdAt) > 0 ? Number(src.createdAt) : now;
  const updatedAt = Number(src.updatedAt) > 0 ? Number(src.updatedAt) : createdAt;
  const history = Array.isArray(src.campaignHistory) ? src.campaignHistory.slice() : [];
  const baseNotes = src.baseNotes !== undefined
    ? String(src.baseNotes).trim()
    : (src.notes ? String(src.notes).trim() : '');

  const campaignStates = {};
  const hasStatesMap = src.campaignStates && typeof src.campaignStates === 'object' && !Array.isArray(src.campaignStates);
  if (hasStatesMap) {
    Object.keys(src.campaignStates).forEach((cid) => {
      if (cid) {
        campaignStates[String(cid).trim()] = normalizeCampaignState(src.campaignStates[cid], updatedAt);
      }
    });
  }

  if (Object.keys(campaignStates).length === 0) {
    const targetCampId = resolveTargetCampaignForLegacy(src, fallbackCampaignId, options);
    campaignStates[targetCampId] = normalizeCampaignState(src, updatedAt);
  }
  hydrateLegacyHistoryIntoStates(history, campaignStates, updatedAt);

  return {
    schemaVersion: SCHEMA_VERSION_V4,
    id: src.id ? String(src.id) : '',
    name: src.name ? String(src.name).trim() : '',
    phone: normalizePhone(src.phone),
    instagram: normalizeInstagram(src.instagram),
    rubro: normalizeRubro(src.rubro),
    baseNotes: baseNotes,
    campaignStates: campaignStates,
    campaignHistory: history,
    createdAt: createdAt,
    updatedAt: updatedAt
  };
}

export const normalizeRecord = normalizeMasterRecord;

export function getPreviousPurchases(masterLead, activeCampaignId, campaignsById) {
  const states = masterLead && masterLead.campaignStates ? masterLead.campaignStates : {};
  const countedIds = new Set();
  const names = [];
  let count = 0;
  let totalSpent = 0;

  Object.keys(states).forEach((cid) => {
    if (cid === activeCampaignId) { return; }
    const st = states[cid];
    if (st && st.stage === 'vendido') {
      countedIds.add(cid);
      count += 1;
      totalSpent += parseSaleAmount(st.saleAmount);
      const campObj = campaignsById && campaignsById[cid] ? campaignsById[cid] : null;
      names.push(campObj && campObj.name ? campObj.name : 'Campaña previa');
    }
  });

  const history = masterLead && Array.isArray(masterLead.campaignHistory) ? masterLead.campaignHistory : [];
  history.forEach((entry) => {
    if (!(entry && entry.campaignId)) { return; }
    const cid = String(entry.campaignId);
    if (cid === activeCampaignId) { return; }
    if (countedIds.has(cid)) { return; }
    if (normalizeStatus(entry.status) === 'vendido') {
      countedIds.add(cid);
      count += 1;
      totalSpent += parseSaleAmount(entry.saleAmount);
      names.push(entry.campaignName ? String(entry.campaignName) : 'Campaña previa');
    }
  });

  return {
    hasBoughtBefore: count > 0,
    count: count,
    totalSpent: Math.round(totalSpent * 100) / 100,
    campaignNames: names
  };
}

export function hasBoughtInAnyCampaign(masterLead, excludeCampaignId) {
  return getPreviousPurchases(masterLead, excludeCampaignId, null).hasBoughtBefore;
}

export function projectLeadForCampaign(masterLead, campaignId, campaignsById) {
  if (!(masterLead && masterLead.campaignStates)) { return null; }
  const targetCid = campaignId ? String(campaignId) : DEFAULT_CAMPAIGN_ID;
  const campState = masterLead.campaignStates[targetCid];
  if (!campState) { return null; }
  return {
    id: masterLead.id,
    name: masterLead.name,
    phone: masterLead.phone,
    instagram: masterLead.instagram,
    rubro: masterLead.rubro,
    baseNotes: masterLead.baseNotes,
    notes: masterLead.baseNotes,
    createdAt: masterLead.createdAt,
    campaignId: targetCid,
    stage: campState.stage,
    status: campState.stage,
    channelUsed: campState.channelUsed,
    contactMethod: campState.contactMethod ? campState.contactMethod : '',
    score: campState.score !== undefined ? campState.score : null,
    waLineUsed: campState.waLineUsed,
    isMetaBot: Boolean(campState.isMetaBot),
    sentTags: Array.isArray(campState.sentTags) ? campState.sentTags.slice() : [],
    interestTags: Array.isArray(campState.interestTags) ? campState.interestTags.slice() : [],
    quickNotes: Array.isArray(campState.quickNotes) ? campState.quickNotes.slice() : [],
    reminderAt: campState.reminderAt,
    reminderReason: campState.reminderReason,
    suggestedMessage: campState.suggestedMessage ? campState.suggestedMessage : '',
    saleAmount: parseSaleAmount(campState.saleAmount),
    lastContactAt: campState.lastContactAt,
    updatedAt: campState.updatedAt,
    previousPurchases: getPreviousPurchases(masterLead, targetCid, campaignsById)
  };
}

function mergeSentTags(primaryTags, secondaryTags) {
  const byId = new Map();
  const ingest = (list, preferIncoming) => {
    list.forEach((tag) => {
      const existing = byId.get(tag.id);
      if (!existing) { byId.set(tag.id, Object.assign({}, tag)); return; }
      const tagTime = Number(tag.sentAt) > 0 ? Number(tag.sentAt) : 0;
      const exTime = Number(existing.sentAt) > 0 ? Number(existing.sentAt) : 0;
      const takeTag = tagTime > exTime ? true : (tagTime === exTime && preferIncoming);
      const winner = takeTag ? tag : existing;
      const other = takeTag ? existing : tag;
      const merged = Object.assign({}, winner);
      const needsPhase = merged.phase === undefined ? true : merged.phase === 0;
      if (needsPhase && Number(other.phase) > 0) { merged.phase = Number(other.phase); }
      byId.set(tag.id, merged);
    });
  };
  ingest(secondaryTags, false);
  ingest(primaryTags, true);
  return Array.from(byId.values()).sort((a, b) => Number(a.sentAt) - Number(b.sentAt));
}

function mergeQuickNotes(listA, listB) {
  return dedupeQuickNotes(listA.concat(listB)).sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

function mergeCampaignHistories(listA, listB) {
  const seen = new Set();
  const merged = [];
  listA.concat(listB).forEach((entry) => {
    if (!(entry && typeof entry === 'object')) { return; }
    const cidPart = entry.campaignId ? String(entry.campaignId) : '';
    const tsPart = Number(entry.archivedAt) > 0 ? Number(entry.archivedAt) : 0;
    const sig = cidPart + '::' + tsPart;
    if (seen.has(sig)) { return; }
    seen.add(sig);
    merged.push(Object.assign({}, entry));
  });
  return merged.sort((a, b) => (Number(a.archivedAt) > 0 ? Number(a.archivedAt) : 0) - (Number(b.archivedAt) > 0 ? Number(b.archivedAt) : 0));
}

function mergeSingleCampaignState(curState, incState) {
  const curUp = Number(curState.updatedAt) > 0 ? Number(curState.updatedAt) : 0;
  const incUp = Number(incState.updatedAt) > 0 ? Number(incState.updatedAt) : 0;
  const primary = incUp >= curUp ? incState : curState;
  const secondary = incUp >= curUp ? curState : incState;
  const mergedSentTags = mergeSentTags(primary.sentTags, secondary.sentTags);
  let mergedInterest = primary.interestTags.slice();
  if (curState.interestTags.length === 0) { mergedInterest = incState.interestTags.slice(); }
  else if (incState.interestTags.length === 0) { mergedInterest = curState.interestTags.slice(); }
  const lastContactAt = Math.max(
    Number(curState.lastContactAt) > 0 ? Number(curState.lastContactAt) : 0,
    Number(incState.lastContactAt) > 0 ? Number(incState.lastContactAt) : 0,
    computeLastContactAt(primary, mergedSentTags)
  );
  return normalizeCampaignState({
    stage: primary.stage,
    channelUsed: primary.channelUsed ? primary.channelUsed : secondary.channelUsed,
    contactMethod: primary.contactMethod ? primary.contactMethod : secondary.contactMethod,
    score: primary.score !== null && primary.score !== undefined ? primary.score : secondary.score,
    waLineUsed: primary.waLineUsed ? primary.waLineUsed : secondary.waLineUsed,
    isMetaBot: primary.stage === 'descartado' ? Boolean(primary.isMetaBot ? primary.isMetaBot : secondary.isMetaBot) : false,
    saleAmount: primary.stage === 'vendido' ? (primary.saleAmount > 0 ? primary.saleAmount : secondary.saleAmount) : 0,
    reminderAt: primary.reminderAt,
    reminderReason: primary.reminderReason,
    suggestedMessage: primary.suggestedMessage ? primary.suggestedMessage : secondary.suggestedMessage,
    sentTags: mergedSentTags,
    interestTags: mergedInterest,
    quickNotes: mergeQuickNotes(primary.quickNotes, secondary.quickNotes),
    lastContactAt: lastContactAt,
    updatedAt: Math.max(curUp, incUp)
  });
}

export function mergeMasterLeadRecords(current, incoming, fallbackCampaignId, options) {
  const cur = normalizeMasterRecord(current, fallbackCampaignId, options);
  const inc = normalizeMasterRecord(incoming, fallbackCampaignId, options);
  const now = Date.now();
  const primary = inc.updatedAt >= cur.updatedAt ? inc : cur;
  const secondary = inc.updatedAt >= cur.updatedAt ? cur : inc;

  const mergedStates = {};
  const allCampIds = new Set(Object.keys(cur.campaignStates).concat(Object.keys(inc.campaignStates)));
  allCampIds.forEach((cid) => {
    const cState = cur.campaignStates[cid];
    const iState = inc.campaignStates[cid];
    if (cState && iState) { mergedStates[cid] = mergeSingleCampaignState(cState, iState); }
    else if (cState) { mergedStates[cid] = normalizeCampaignState(cState); }
    else if (iState) { mergedStates[cid] = normalizeCampaignState(iState); }
  });

  const maxUpdated = Math.max(cur.updatedAt, inc.updatedAt);
  return normalizeMasterRecord({
    schemaVersion: SCHEMA_VERSION_V4,
    id: cur.id ? cur.id : inc.id,
    name: primary.name ? primary.name : secondary.name,
    phone: primary.phone ? primary.phone : secondary.phone,
    instagram: primary.instagram ? primary.instagram : secondary.instagram,
    rubro: primary.rubro ? primary.rubro : secondary.rubro,
    baseNotes: primary.baseNotes ? primary.baseNotes : secondary.baseNotes,
    campaignStates: mergedStates,
    campaignHistory: mergeCampaignHistories(cur.campaignHistory, inc.campaignHistory),
    createdAt: Math.min(cur.createdAt, inc.createdAt),
    updatedAt: maxUpdated > 0 ? maxUpdated : now
  }, fallbackCampaignId, options);
}

export const mergeLeadRecords = mergeMasterLeadRecords;
