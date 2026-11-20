export const DEFAULT_COUNTRY_CODE = '51';
export const DEFAULT_CAMPAIGN_ID = 'camp_default';

export function normalizePhone(rawPhone) {
  if (!rawPhone) {
    return '';
  }
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) {
    return DEFAULT_COUNTRY_CODE + digits;
  }
  return digits;
}

export function parseSaleAmount(rawAmount) {
  const parsed = Number(rawAmount);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

export function normalizeStatus(rawStatus) {
  if (!rawStatus) {
    return 'nuevo';
  }
  return rawStatus === 'cerrado' ? 'vendido' : String(rawStatus).trim();
}

export function buildSentTagEntry(tagData, sentTimestamp) {
  const entry = {
    id: String(tagData.id),
    label: tagData.label ? String(tagData.label).trim() : String(tagData.id),
    sentAt: sentTimestamp
  };
  if (tagData.phase !== undefined && tagData.phase !== null) {
    const cleanPhase = Number(tagData.phase);
    entry.phase = (cleanPhase === 1 || cleanPhase === 2 || cleanPhase === 3) ? cleanPhase : 0;
  }
  return entry;
}

export function applySentTagToLead(record, tagData, sentTs, preserveRecentContact) {
  const hadPrior = record.sentTags.length > 0 || record.quickNotes.length > 0 || record.interestTags.length > 0;
  const nextTags = record.sentTags.filter((item) => item.id !== tagData.id);
  nextTags.push(buildSentTagEntry(tagData, sentTs));
  record.sentTags = nextTags;
  record.lastContactAt = (preserveRecentContact && hadPrior)
    ? Math.max(Number(record.lastContactAt) || 0, sentTs)
    : sentTs;
}

export function normalizeTagList(rawTags, timeField) {
  if (!Array.isArray(rawTags)) {
    return [];
  }
  const cleanList = [];
  rawTags.forEach((item) => {
    if (!item || !item.id) {
      return;
    }
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
  if (!Array.isArray(rawNotes)) {
    return [];
  }
  const cleanList = [];
  rawNotes.forEach((item, idx) => {
    if (item && item.text) {
      const cleanText = String(item.text).trim();
      if (!cleanText) {
        return;
      }
      cleanList.push({
        id: item.id
          ? String(item.id)
          : 'note_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).slice(2, 6),
        text: cleanText,
        createdAt: Number(item.createdAt) > 0 ? Number(item.createdAt) : Date.now()
      });
    }
  });
  return cleanList;
}

export function computeLastContactAt(record, sentTags) {
  let latest = record && Number(record.lastContactAt) > 0 ? Number(record.lastContactAt) : 0;
  if (Array.isArray(sentTags)) {
    sentTags.forEach((tag) => {
      if (Number(tag.sentAt) > latest) {
        latest = Number(tag.sentAt);
      }
    });
  }
  if (latest > 0) {
    return latest;
  }
  return record && Number(record.updatedAt) > 0 ? Number(record.updatedAt) : Date.now();
}

export function normalizeRecord(record) {
  const src = record && typeof record === 'object' ? record : {};
  const cleanStatus = normalizeStatus(src.status);
  const sentTags = normalizeTagList(src.sentTags, 'sentAt');
  const interestTags = normalizeTagList(src.interestTags, 'taggedAt');
  const quickNotes = normalizeQuickNotes(src.quickNotes);
  const history = Array.isArray(src.campaignHistory) ? src.campaignHistory.slice() : [];
  return Object.assign({}, src, {
    name: src.name ? String(src.name).trim() : '',
    phone: normalizePhone(src.phone),
    status: cleanStatus,
    rubro: src.rubro ? String(src.rubro).trim().toLowerCase() : '',
    sentTags: sentTags,
    interestTags: interestTags,
    quickNotes: quickNotes,
    lastContactAt: computeLastContactAt(src, sentTags),
    saleAmount: cleanStatus === 'vendido' ? parseSaleAmount(src.saleAmount) : 0,
    reminderAt: src.reminderAt ? String(src.reminderAt).trim() : '',
    reminderReason: src.reminderReason ? String(src.reminderReason).trim() : '',
    notes: src.notes ? String(src.notes).trim() : '',
    campaignId: src.campaignId ? String(src.campaignId).trim() : DEFAULT_CAMPAIGN_ID,
    campaignHistory: history
  });
}

export function applyArchiveToLead(record, newCampaignId, previousCampaignName, now) {
  const hadReminder = Boolean(record.reminderAt);
  const hasActivity = record.status !== 'nuevo' ||
    record.sentTags.length > 0 ||
    record.interestTags.length > 0 ||
    record.quickNotes.length > 0;
  if (hasActivity) {
    record.campaignHistory.push({
      campaignId: record.campaignId,
      campaignName: previousCampaignName ? String(previousCampaignName) : 'Campaña previa',
      status: record.status,
      saleAmount: record.saleAmount,
      sentTags: record.sentTags.slice(),
      interestTags: record.interestTags.slice(),
      quickNotes: record.quickNotes.slice(),
      archivedAt: now
    });
  }
  record.campaignId = newCampaignId;
  record.status = record.status === 'sin_whatsapp' ? 'sin_whatsapp' : 'nuevo';
  record.sentTags = [];
  record.interestTags = [];
  record.quickNotes = [];
  record.saleAmount = 0;
  record.reminderAt = '';
  record.reminderReason = '';
  record.updatedAt = now;
  return hadReminder;
}

function mergeSentTags(primaryTags, secondaryTags) {
  const byId = new Map();
  const ingest = (list, preferIncoming) => {
    list.forEach((tag) => {
      const existing = byId.get(tag.id);
      if (!existing) {
        byId.set(tag.id, Object.assign({}, tag));
        return;
      }
      const tagTime = Number(tag.sentAt) || 0;
      const exTime = Number(existing.sentAt) || 0;
      const takeTag = tagTime > exTime || (tagTime === exTime && preferIncoming);
      const winner = takeTag ? tag : existing;
      const other = takeTag ? existing : tag;
      const merged = Object.assign({}, winner);
      if ((merged.phase === undefined || merged.phase === 0) && Number(other.phase) > 0) {
        merged.phase = Number(other.phase);
      }
      byId.set(tag.id, merged);
    });
  };
  ingest(secondaryTags, false);
  ingest(primaryTags, true);
  return Array.from(byId.values()).sort((a, b) => Number(a.sentAt) - Number(b.sentAt));
}

function mergeQuickNotes(listA, listB) {
  const seenIds = new Set();
  const seenSigs = new Set();
  const merged = [];
  listA.concat(listB).forEach((note) => {
    const sig = note.text + '|' + note.createdAt;
    if (seenIds.has(note.id) || seenSigs.has(sig)) {
      return;
    }
    seenIds.add(note.id);
    seenSigs.add(sig);
    merged.push(Object.assign({}, note));
  });
  merged.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  return merged;
}

function mergeCampaignHistories(listA, listB) {
  const seen = new Set();
  const merged = [];
  listA.concat(listB).forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const sig = (entry.campaignId ? String(entry.campaignId) : '') + '|' + (Number(entry.archivedAt) || 0);
    if (seen.has(sig)) {
      return;
    }
    seen.add(sig);
    merged.push(Object.assign({}, entry));
  });
  merged.sort((a, b) => (Number(a.archivedAt) || 0) - (Number(b.archivedAt) || 0));
  return merged;
}

export function mergeLeadRecords(current, incoming) {
  const cur = normalizeRecord(current);
  const inc = normalizeRecord(incoming);
  const now = Date.now();
  const curUpdated = Number(cur.updatedAt) > 0 ? Number(cur.updatedAt) : 0;
  const incUpdated = Number(inc.updatedAt) > 0 ? Number(inc.updatedAt) : 0;
  const incNewer = incUpdated >= curUpdated;
  const primary = incNewer ? inc : cur;
  const secondary = incNewer ? cur : inc;

  const mergedSentTags = mergeSentTags(primary.sentTags, secondary.sentTags);
  let mergedInterest = primary.interestTags.slice();
  if (cur.interestTags.length === 0) {
    mergedInterest = inc.interestTags.slice();
  } else if (inc.interestTags.length === 0) {
    mergedInterest = cur.interestTags.slice();
  }
  const mergedNotes = mergeQuickNotes(primary.quickNotes, secondary.quickNotes);
  const mergedHistory = mergeCampaignHistories(cur.campaignHistory, inc.campaignHistory);

  const curCreated = Number(cur.createdAt) > 0 ? Number(cur.createdAt) : now;
  const incCreated = Number(inc.createdAt) > 0 ? Number(inc.createdAt) : now;
  const lastContactAt = Math.max(
    Number(cur.lastContactAt) || 0,
    Number(inc.lastContactAt) || 0,
    computeLastContactAt(primary, mergedSentTags)
  );

  return normalizeRecord(Object.assign({}, secondary, primary, {
    id: cur.id,
    name: primary.name || secondary.name,
    phone: cur.phone || inc.phone,
    rubro: primary.rubro || secondary.rubro,
    notes: primary.notes || secondary.notes,
    status: primary.status,
    saleAmount: primary.status === 'vendido'
      ? (primary.saleAmount > 0 ? primary.saleAmount : secondary.saleAmount)
      : 0,
    reminderAt: primary.reminderAt,
    reminderReason: primary.reminderReason,
    campaignId: primary.campaignId || secondary.campaignId || DEFAULT_CAMPAIGN_ID,
    sentTags: mergedSentTags,
    interestTags: mergedInterest,
    quickNotes: mergedNotes,
    campaignHistory: mergedHistory,
    createdAt: Math.min(curCreated, incCreated),
    updatedAt: Math.max(curUpdated, incUpdated) || now,
    lastContactAt: lastContactAt
  }));
}
