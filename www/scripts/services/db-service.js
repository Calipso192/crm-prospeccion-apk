import {
  DEFAULT_CAMPAIGN_ID, normalizePhone, normalizeInstagram, normalizeChannel, normalizeWaLine,
  normalizeStatus, parseSaleAmount, createDefaultCampaignState, normalizeCampaignState,
  normalizeMasterRecord, mergeMasterLeadRecords, applySentTagToCampaignState,
  needsV4Migration, hasBoughtInAnyCampaign
} from './lead-schema.js';
import {
  enqueueWrite, waitForWriteQueue, getAutoBackupMeta, resetAutoBackupCounter,
  readMirrorSnapshot, runTx, readAllRawFromDb, refreshMirrorFromDb
} from './db-storage.js';

export {
  getAutoBackupMeta, resetAutoBackupCounter,
  normalizePhone, normalizeInstagram, normalizeMasterRecord, normalizeMasterRecord as normalizeRecord
};

function hasValidChannel(phone, instagram) {
  return phone.length >= 7 ? true : instagram.length >= 2;
}

function findMatchingMaster(list, cleanPhone, cleanIg, excludeId) {
  const shortPhone = (cleanPhone.length === 11 && cleanPhone.startsWith('51')) ? cleanPhone.slice(2) : '';
  return list.find((item) => {
    if (excludeId && item.id === excludeId) { return false; }
    if (cleanPhone && item.phone) {
      if (item.phone === cleanPhone ? true : (shortPhone && item.phone === shortPhone)) { return true; }
      if (item.phone.length === 11 && item.phone.startsWith('51') && item.phone.slice(2) === cleanPhone) { return true; }
    }
    return Boolean(cleanIg && item.instagram && item.instagram === cleanIg);
  });
}

function registerInMaps(item, byPhone, byIg, byId) {
  if (item.phone) {
    byPhone.set(item.phone, item);
    if (item.phone.length === 11 && item.phone.startsWith('51')) { byPhone.set(item.phone.slice(2), item); }
  }
  if (item.instagram) { byIg.set(item.instagram, item); }
  if (item.id && byId) { byId.set(item.id, item); }
}

function findInMaps(byPhone, byIg, cleanPhone, cleanIg) {
  if (cleanPhone) {
    const direct = byPhone.get(cleanPhone);
    if (direct) { return direct; }
    if (cleanPhone.length === 11 && cleanPhone.startsWith('51')) { return byPhone.get(cleanPhone.slice(2)) || null; }
  }
  return cleanIg ? byIg.get(cleanIg) : null;
}

async function _mergeImportedLeadsCore(incomingLeads, options) {
  const list = Array.isArray(incomingLeads) ? incomingLeads : [];
  if (list.length === 0) { return { added: 0, updated: 0 }; }
  const opts = options ? options : {};
  const fallbackCampId = opts.defaultCampaignId ? String(opts.defaultCampaignId) : DEFAULT_CAMPAIGN_ID;
  const stats = await runTx('readwrite', (store, setResult) => {
    store.getAll().onsuccess = (ev) => {
      const rawList = Array.isArray(ev.target.result) ? ev.target.result : [];
      const byPhone = new Map();
      const byIg = new Map();
      const byId = new Map();
      rawList.map((x) => normalizeMasterRecord(x, fallbackCampId)).forEach((item) => registerInMaps(item, byPhone, byIg, byId));
      const now = Date.now();
      let added = 0;
      let updated = 0;
      list.forEach((raw, idx) => {
        const cleanPhone = normalizePhone(raw && raw.phone);
        const cleanIg = normalizeInstagram(raw && raw.instagram);
        if (!hasValidChannel(cleanPhone, cleanIg)) { return; }
        const incoming = normalizeMasterRecord(Object.assign({}, raw, { phone: cleanPhone, instagram: cleanIg }), fallbackCampId, opts);
        let current = cleanPhone ? byPhone.get(cleanPhone) : null;
        if (!current && cleanIg) { current = byIg.get(cleanIg); }
        if (!current && incoming.id) { current = byId.get(incoming.id); }
        if (!current) {
          const id = incoming.id ? String(incoming.id) : 'lead_' + now + '_' + idx + '_' + Math.random().toString(36).slice(2, 7);
          const createdAt = Number(incoming.createdAt) > 0 ? Number(incoming.createdAt) : now;
          const updatedAt = Number(incoming.updatedAt) > 0 ? Number(incoming.updatedAt) : createdAt;
          const fresh = normalizeMasterRecord(Object.assign({}, incoming, { id, createdAt, updatedAt }), fallbackCampId, opts);
          store.put(fresh);
          registerInMaps(fresh, byPhone, byIg, byId);
          added += 1;
        } else {
          const merged = mergeMasterLeadRecords(current, incoming, fallbackCampId, opts);
          store.put(merged);
          registerInMaps(merged, byPhone, byIg, byId);
          updated += 1;
        }
      });
      setResult({ added, updated });
    };
  });
  await refreshMirrorFromDb(!opts.skipIncrementChanges, fallbackCampId);
  return stats;
}

function updateSingleMaster(leadId, updaterFn) {
  return enqueueWrite(async () => {
    const updated = await runTx('readwrite', (store, setResult) => {
      store.get(leadId).onsuccess = (ev) => {
        if (!ev.target.result) { setResult(null); return; }
        const record = normalizeMasterRecord(ev.target.result);
        const now = Date.now();
        updaterFn(record, now);
        record.updatedAt = now;
        store.put(record);
        setResult(record);
      };
    });
    if (updated) { await refreshMirrorFromDb(true); }
    return updated;
  });
}

function updateCampaignState(leadId, campaignId, updaterFn) {
  const targetCid = campaignId ? String(campaignId) : DEFAULT_CAMPAIGN_ID;
  return updateSingleMaster(leadId, (record, now) => {
    const existing = record.campaignStates[targetCid];
    const campState = existing ? normalizeCampaignState(existing, now) : createDefaultCampaignState('nuevo', now);
    updaterFn(campState, record, now);
    campState.updatedAt = now;
    record.campaignStates[targetCid] = campState;
  });
}

async function _mutateAllRecordsCore(mutatorFn, options) {
  const count = await runTx('readwrite', (store, setResult) => {
    store.getAll().onsuccess = (ev) => {
      const now = Date.now();
      let updatedCount = 0;
      (Array.isArray(ev.target.result) ? ev.target.result : []).forEach((raw) => {
        const record = normalizeMasterRecord(raw);
        if (mutatorFn(record, now)) { store.put(record); updatedCount += 1; }
      });
      setResult(updatedCount);
    };
  });
  if (count > 0) { await refreshMirrorFromDb(!(options && options.skipIncrementChanges)); }
  return count;
}

function mutateAllCampaignStates(stateMutatorFn, options) {
  return enqueueWrite(() => _mutateAllRecordsCore((record) => {
    let changed = false;
    Object.keys(record.campaignStates).forEach((cid) => {
      if (stateMutatorFn(record.campaignStates[cid], cid)) { changed = true; }
    });
    return changed;
  }, options));
}

export async function migrateDatabaseToV4(activeCampaignId) {
  const targetCid = activeCampaignId ? String(activeCampaignId) : DEFAULT_CAMPAIGN_ID;
  return enqueueWrite(async () => {
    const rawRecords = await readAllRawFromDb();
    if (rawRecords.length === 0) {
      const meta = getAutoBackupMeta();
      if (!meta.explicitlyEmpty && !meta.mirrorQuotaExceeded && !meta.mirrorDisabledForScale) {
        const mirrorRecords = readMirrorSnapshot(targetCid);
        if (mirrorRecords.length > 0) {
          await _mergeImportedLeadsCore(mirrorRecords, { defaultCampaignId: targetCid, skipIncrementChanges: true, forceFallbackForLegacy: true });
          return { migratedCount: mirrorRecords.length, totalCount: mirrorRecords.length };
        }
      }
      return { migratedCount: 0, totalCount: 0 };
    }
    const migratedCount = await runTx('readwrite', (store, setResult) => {
      let count = 0;
      rawRecords.forEach((item) => {
        if (needsV4Migration(item)) { store.put(normalizeMasterRecord(item, targetCid, { forceFallbackForLegacy: true })); count += 1; }
      });
      setResult(count);
    });
    if (migratedCount > 0) { await refreshMirrorFromDb(false, targetCid); }
    return { migratedCount: migratedCount, totalCount: rawRecords.length };
  });
}

export async function getAllLeads(fallbackCampaignId) {
  await waitForWriteQueue();
  const rawRecords = await readAllRawFromDb();
  return rawRecords.map((item) => normalizeMasterRecord(item, fallbackCampaignId)).sort((a, b) => b.updatedAt - a.updatedAt);
}

function buildInputCampaignState(leadData, baseState, now) {
  const stage = normalizeStatus(leadData.stage ? leadData.stage : leadData.status);
  const seed = baseState ? baseState : createDefaultCampaignState(stage, now);
  return normalizeCampaignState(Object.assign({}, seed, {
    stage: stage,
    saleAmount: stage === 'vendido' ? parseSaleAmount(leadData.saleAmount) : 0,
    reminderAt: leadData.reminderAt !== undefined ? leadData.reminderAt : seed.reminderAt,
    reminderReason: leadData.reminderReason !== undefined ? leadData.reminderReason : seed.reminderReason,
    updatedAt: now
  }), now);
}

function createFreshMaster(name, phone, instagram, rubro, baseNotes, campaignId, stateObj, now, idx) {
  const suffix = idx !== undefined ? idx + '_' : '';
  return normalizeMasterRecord({
    schemaVersion: 4,
    id: 'lead_' + now + '_' + suffix + Math.random().toString(36).slice(2, 7),
    name: name, phone: phone, instagram: instagram, rubro: rubro, baseNotes: baseNotes,
    campaignStates: { [campaignId]: stateObj }, campaignHistory: [], createdAt: now, updatedAt: now
  }, campaignId);
}

function enrollIntoExistingMaster(master, campaignId, stateObj, cleanPhone, cleanIg, rubro, baseNotes, now) {
  return normalizeMasterRecord(Object.assign({}, master, {
    phone: master.phone ? master.phone : cleanPhone,
    instagram: master.instagram ? master.instagram : cleanIg,
    rubro: master.rubro ? master.rubro : (rubro ? String(rubro).trim().toLowerCase() : ''),
    baseNotes: master.baseNotes ? master.baseNotes : (baseNotes ? String(baseNotes).trim() : ''),
    campaignStates: Object.assign({}, master.campaignStates, { [campaignId]: stateObj }),
    updatedAt: now
  }), campaignId);
}

export function saveLead(leadData, options) {
  const cleanPhone = normalizePhone(leadData && leadData.phone);
  const cleanIg = normalizeInstagram(leadData && leadData.instagram);
  if (!hasValidChannel(cleanPhone, cleanIg)) {
    return Promise.reject(new Error('Ingresa un teléfono válido o un usuario de @instagram.'));
  }
  const targetCid = leadData && leadData.campaignId ? String(leadData.campaignId) : DEFAULT_CAMPAIGN_ID;
  return enqueueWrite(async () => {
    const saved = await runTx('readwrite', (store, setResult, rejectTx) => {
      store.getAll().onsuccess = (ev) => {
        const allMaster = (Array.isArray(ev.target.result) ? ev.target.result : []).map((x) => normalizeMasterRecord(x, targetCid));
        const existingById = leadData.id ? allMaster.find((x) => x.id === leadData.id) : null;
        const duplicate = findMatchingMaster(allMaster, cleanPhone, cleanIg, leadData.id);
        const now = Date.now();
        const baseNotesVal = leadData.baseNotes !== undefined ? leadData.baseNotes : leadData.notes;

        if (existingById) {
          if (duplicate) { rejectTx(new Error('Ya existe otro contacto con ese teléfono o @instagram ("' + duplicate.name + '").')); return; }
          const nextState = buildInputCampaignState(leadData, existingById.campaignStates[targetCid], now);
          const updatedRec = normalizeMasterRecord(Object.assign({}, existingById, {
            name: leadData.name.trim(), phone: cleanPhone, instagram: cleanIg,
            rubro: leadData.rubro !== undefined ? leadData.rubro : existingById.rubro,
            baseNotes: baseNotesVal !== undefined ? baseNotesVal : existingById.baseNotes,
            campaignStates: Object.assign({}, existingById.campaignStates, { [targetCid]: nextState }),
            updatedAt: now
          }), targetCid);
          store.put(updatedRec);
          setResult(updatedRec);
          return;
        }

        const newState = buildInputCampaignState(leadData, null, now);
        if (duplicate) {
          if (duplicate.campaignStates && duplicate.campaignStates[targetCid]) {
            if (options && options.skipDuplicate) { setResult({ skipped: true, existing: duplicate }); return; }
            rejectTx(new Error('Este contacto ya está en la campaña actual como "' + duplicate.name + '".'));
            return;
          }
          const enrolled = enrollIntoExistingMaster(duplicate, targetCid, newState, cleanPhone, cleanIg, leadData.rubro, baseNotesVal, now);
          store.put(enrolled);
          setResult(enrolled);
          return;
        }

        const fresh = createFreshMaster(leadData.name.trim(), cleanPhone, cleanIg, leadData.rubro ? leadData.rubro : '', baseNotesVal ? baseNotesVal : '', targetCid, newState, now);
        store.put(fresh);
        setResult(fresh);
      };
    });
    if (saved && !saved.skipped) { await refreshMirrorFromDb(true, targetCid); }
    return saved;
  });
}

export function bulkInsertLeads(leadsList, options) {
  const list = Array.isArray(leadsList) ? leadsList : [];
  if (list.length === 0) { return Promise.resolve({ added: 0, skipped: 0 }); }
  const campaignId = options && options.defaultCampaignId ? String(options.defaultCampaignId) : DEFAULT_CAMPAIGN_ID;
  return enqueueWrite(async () => {
    const stats = await runTx('readwrite', (store, setResult) => {
      store.getAll().onsuccess = (ev) => {
        const byPhone = new Map();
        const byIg = new Map();
        (Array.isArray(ev.target.result) ? ev.target.result : []).map((x) => normalizeMasterRecord(x, campaignId)).forEach((item) => registerInMaps(item, byPhone, byIg, null));
        const now = Date.now();
        let added = 0;
        let skipped = 0;
        list.forEach((raw, idx) => {
          const cleanPhone = normalizePhone(raw && raw.phone);
          const cleanIg = normalizeInstagram(raw && raw.instagram);
          const cleanName = raw && raw.name ? String(raw.name).trim() : '';
          if (!(cleanName && hasValidChannel(cleanPhone, cleanIg))) { return; }
          const suggestedChan = normalizeChannel(raw && (raw.channelUsed ? raw.channelUsed : raw.channel));
          const initialState = createDefaultCampaignState('nuevo', now);
          if (suggestedChan) { initialState.channelUsed = suggestedChan; }
          const cleanNotes = raw && raw.baseNotes ? String(raw.baseNotes).trim() : '';
          const match = findInMaps(byPhone, byIg, cleanPhone, cleanIg);
          if (match) {
            if (match.campaignStates && match.campaignStates[campaignId]) { skipped += 1; return; }
            const enrolled = enrollIntoExistingMaster(match, campaignId, initialState, cleanPhone, cleanIg, raw.rubro, cleanNotes, now);
            store.put(enrolled);
            registerInMaps(enrolled, byPhone, byIg, null);
            added += 1;
            return;
          }
          const fresh = createFreshMaster(cleanName, cleanPhone, cleanIg, raw.rubro ? String(raw.rubro).trim().toLowerCase() : '', cleanNotes, campaignId, initialState, now, idx);
          store.put(fresh);
          registerInMaps(fresh, byPhone, byIg, null);
          added += 1;
        });
        setResult({ added, skipped });
      };
    });
    if (stats.added > 0) { await refreshMirrorFromDb(true, campaignId); }
    return stats;
  });
}

export function enrollLeadsInCampaign(newCampaignId, mode) {
  const cleanMode = mode ? String(mode) : 'empty';
  if (cleanMode === 'empty' ? true : !newCampaignId) { return Promise.resolve({ enrolledCount: 0 }); }
  return enqueueWrite(async () => {
    const enrolledCount = await _mutateAllRecordsCore((record, now) => {
      if (record.campaignStates[newCampaignId]) { return false; }
      if (cleanMode === 'buyers' && !hasBoughtInAnyCampaign(record, newCampaignId)) { return false; }
      record.campaignStates[newCampaignId] = createDefaultCampaignState('nuevo', now);
      record.updatedAt = now;
      return true;
    });
    return { enrolledCount: enrolledCount };
  });
}

function setStageState(cs, stage, now, amount, isMetaBot) {
  cs.stage = stage;
  cs.saleAmount = stage === 'vendido' ? parseSaleAmount(amount) : 0;
  cs.isMetaBot = stage === 'descartado' ? Boolean(isMetaBot) : false;
  cs.lastContactAt = now;
}

export function updateLeadRubro(leadId, newRubro) {
  return updateSingleMaster(leadId, (record) => { record.rubro = newRubro ? String(newRubro).trim().toLowerCase() : ''; });
}

export function updateLeadCampaignStage(leadId, campaignId, targetStage, extra) {
  return updateCampaignState(leadId, campaignId, (cs, record, now) => {
    const cleanStage = normalizeStatus(targetStage);
    const botFlag = extra && extra.isMetaBot !== undefined ? Boolean(extra.isMetaBot) : cs.isMetaBot;
    setStageState(cs, cleanStage, now, extra && extra.saleAmount, botFlag);
  });
}

export function applyLeadWhatsAppOutcome(leadId, campaignId, outcomeAction, pendingTpl, waLineUsed) {
  return updateCampaignState(leadId, campaignId, (cs, record, now) => {
    if (outcomeAction === 'sin_whatsapp') { setStageState(cs, 'sin_whatsapp', now, 0, false); return; }
    if (outcomeAction === 'contactado') { setStageState(cs, 'contactado', now, 0, false); }
    cs.channelUsed = 'whatsapp';
    const cleanLine = normalizeWaLine(waLineUsed);
    if (cleanLine) { cs.waLineUsed = cleanLine; }
    if (pendingTpl && pendingTpl.id) { applySentTagToCampaignState(cs, pendingTpl, now, false); }
    cs.lastContactAt = now;
  });
}

export function applyLeadChannelTouch(leadId, campaignId, channelKey) {
  return updateCampaignState(leadId, campaignId, (cs, record, now) => {
    const cleanChan = normalizeChannel(channelKey);
    if (cleanChan) { cs.channelUsed = cleanChan; }
    if (['nuevo', 'sin_whatsapp'].includes(cs.stage)) { setStageState(cs, 'contactado', now, 0, false); }
    cs.lastContactAt = now;
  });
}

export function applyLeadTriageOutcome(leadId, campaignId, outcomeStage, isMetaBot) {
  return updateCampaignState(leadId, campaignId, (cs, record, now) => {
    setStageState(cs, outcomeStage === 'seguimiento' ? 'seguimiento' : 'descartado', now, 0, isMetaBot);
  });
}

export function addTagToLead(leadId, campaignId, tagData) {
  return updateCampaignState(leadId, campaignId, (cs, record, now) => {
    applySentTagToCampaignState(cs, tagData, Number(tagData.sentAt) > 0 ? Number(tagData.sentAt) : now, true);
  });
}

export function removeTagFromLead(leadId, campaignId, tagId) {
  return updateCampaignState(leadId, campaignId, (cs) => { cs.sentTags = cs.sentTags.filter((item) => item.id !== tagId); });
}

export function toggleInterestTag(leadId, campaignId, tagObj) {
  return updateCampaignState(leadId, campaignId, (cs, record, now) => {
    const exists = cs.interestTags.some((item) => item.id === tagObj.id);
    cs.interestTags = exists
      ? cs.interestTags.filter((item) => item.id !== tagObj.id)
      : cs.interestTags.concat([{ id: String(tagObj.id), label: String(tagObj.label).trim(), taggedAt: now }]);
    cs.lastContactAt = now;
  });
}

export function addQuickNoteToLead(leadId, campaignId, noteText) {
  const cleanText = noteText ? String(noteText).trim() : '';
  if (!cleanText) { return Promise.resolve(null); }
  return updateCampaignState(leadId, campaignId, (cs, record, now) => {
    cs.quickNotes.unshift({ id: 'note_' + now + '_' + Math.random().toString(36).slice(2, 6), text: cleanText, createdAt: now });
    cs.lastContactAt = now;
  });
}

export function removeQuickNoteFromLead(leadId, campaignId, noteId) {
  if (!noteId) { return Promise.resolve(null); }
  return updateCampaignState(leadId, campaignId, (cs) => { cs.quickNotes = cs.quickNotes.filter((item) => item.id !== noteId); });
}

export function updateLeadReminder(leadId, campaignId, reminderAt, reminderReason) {
  return updateCampaignState(leadId, campaignId, (cs) => {
    cs.reminderAt = reminderAt ? String(reminderAt).trim() : ''; cs.reminderReason = reminderReason ? String(reminderReason).trim() : '';
  });
}

export function updateLeadSuggestedMessage(leadId, campaignId, msg) {
  return updateCampaignState(leadId, campaignId, (cs) => { cs.suggestedMessage = msg ? String(msg).trim() : ''; });
}

function renameTagsInStates(listKey, tagIdMap, options) {
  return mutateAllCampaignStates((st) => {
    let changed = false;
    st[listKey] = st[listKey].map((tag) => {
      const next = tagIdMap[tag.id];
      if (next && tag.label !== next) { changed = true; return Object.assign({}, tag, { label: next }); }
      return tag;
    });
    return changed;
  }, options);
}

export function syncAllTagLabels(labelsMap) {
  const map = labelsMap && typeof labelsMap === 'object' ? labelsMap : {};
  return Object.keys(map).length === 0 ? Promise.resolve(0) : renameTagsInStates('sentTags', map, { skipIncrementChanges: true });
}

export function renameTagAcrossLeads(tagId, newLabel) {
  const clean = newLabel ? String(newLabel).trim() : '';
  return (tagId && clean) ? syncAllTagLabels({ [tagId]: clean }) : Promise.resolve(0);
}

export function renameInterestTagAcrossLeads(tagId, newLabel) {
  const clean = newLabel ? String(newLabel).trim() : '';
  return (tagId && clean) ? renameTagsInStates('interestTags', { [tagId]: clean }) : Promise.resolve(0);
}

export function removeInterestTagAcrossLeads(tagId) {
  if (!tagId) { return Promise.resolve(0); }
  return mutateAllCampaignStates((st) => {
    const before = st.interestTags.length;
    st.interestTags = st.interestTags.filter((tag) => tag.id !== tagId);
    return st.interestTags.length !== before;
  });
}

export function bulkAssignTagByStatuses(campaignId, statuses, tagData) {
  const targetCid = campaignId ? String(campaignId) : DEFAULT_CAMPAIGN_ID;
  const targetSet = Array.isArray(statuses) ? statuses : [];
  if (targetSet.length === 0 ? true : !(tagData && tagData.id)) { return Promise.resolve(0); }
  return enqueueWrite(() => _mutateAllRecordsCore((record, now) => {
    const cs = record.campaignStates[targetCid];
    if (!(cs && targetSet.includes(cs.stage) && !cs.sentTags.some((t) => t.id === tagData.id))) { return false; }
    applySentTagToCampaignState(cs, tagData, Number(tagData.sentAt) > 0 ? Number(tagData.sentAt) : now, true);
    cs.updatedAt = now;
    record.updatedAt = now;
    return true;
  }));
}

export function bulkUpdateByIds(leadIds, mutatorFn) {
  const uniqueIds = Array.from(new Set(Array.isArray(leadIds) ? leadIds : []));
  if (uniqueIds.length === 0) { return Promise.resolve(0); }
  return enqueueWrite(async () => {
    const updatedCount = await runTx('readwrite', (store, setResult) => {
      const now = Date.now();
      let count = 0;
      uniqueIds.forEach((id) => {
        store.get(id).onsuccess = (ev) => {
          if (!ev.target.result) { return; }
          const record = normalizeMasterRecord(ev.target.result);
          if (mutatorFn(record, now)) { record.updatedAt = now; store.put(record); count += 1; setResult(count); }
        };
      });
      setResult(0);
    });
    if (updatedCount > 0) { await refreshMirrorFromDb(true); }
    return updatedCount;
  });
}

export function mergeImportedLeads(incomingLeads, options) {
  return enqueueWrite(() => _mergeImportedLeadsCore(incomingLeads, options));
}

export function deleteLead(id) {
  return enqueueWrite(async () => { await runTx('readwrite', (store) => { store.delete(id); }); await refreshMirrorFromDb(true); return true; });
}
