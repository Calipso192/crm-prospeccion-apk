const DB_NAME = 'crm_prospeccion_db';
const DB_VERSION = 2;
const STORE_NAME = 'leads';
const MIRROR_KEY = 'crm_prospeccion_leads_mirror_v2';
const BACKUP_META_KEY = 'crm_prospeccion_backup_meta_v2';
const DEFAULT_COUNTRY_CODE = '51';
const DEFAULT_CAMPAIGN_ID = 'camp_default';

let dbConnectionPromise = null;

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

function parseSaleAmount(rawAmount) {
  const parsed = Number(rawAmount);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

function normalizeStatus(rawStatus) {
  if (!rawStatus) {
    return 'nuevo';
  }
  return rawStatus === 'cerrado' ? 'vendido' : String(rawStatus).trim();
}

function normalizeTagList(rawTags, timeField) {
  if (!Array.isArray(rawTags)) {
    return [];
  }
  const cleanList = [];
  rawTags.forEach((item) => {
    if (item && item.id) {
      const entry = {
        id: String(item.id),
        label: item.label ? String(item.label).trim() : String(item.id)
      };
      entry[timeField] = Number(item[timeField]) > 0 ? Number(item[timeField]) : Date.now();
      cleanList.push(entry);
    }
  });
  return cleanList;
}

function normalizeQuickNotes(rawNotes) {
  if (!Array.isArray(rawNotes)) {
    return [];
  }
  const cleanList = [];
  rawNotes.forEach((item) => {
    if (item && item.text) {
      cleanList.push({
        id: item.id ? String(item.id) : 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        text: String(item.text).trim(),
        createdAt: Number(item.createdAt) > 0 ? Number(item.createdAt) : Date.now()
      });
    }
  });
  return cleanList;
}

function computeLastContactAt(record, sentTags) {
  let latest = Number(record.lastContactAt) > 0 ? Number(record.lastContactAt) : 0;
  sentTags.forEach((tag) => {
    if (tag.sentAt > latest) {
      latest = tag.sentAt;
    }
  });
  if (latest > 0) {
    return latest;
  }
  return Number(record.updatedAt) > 0 ? Number(record.updatedAt) : Date.now();
}

export function normalizeRecord(record) {
  const cleanStatus = normalizeStatus(record.status);
  const sentTags = normalizeTagList(record.sentTags, 'sentAt');
  const interestTags = normalizeTagList(record.interestTags, 'taggedAt');
  const quickNotes = normalizeQuickNotes(record.quickNotes);
  const history = Array.isArray(record.campaignHistory) ? record.campaignHistory.slice() : [];
  return Object.assign({}, record, {
    status: cleanStatus,
    rubro: record.rubro ? String(record.rubro).trim().toLowerCase() : '',
    sentTags: sentTags,
    interestTags: interestTags,
    quickNotes: quickNotes,
    lastContactAt: computeLastContactAt(record, sentTags),
    saleAmount: cleanStatus === 'vendido' ? parseSaleAmount(record.saleAmount) : 0,
    reminderAt: record.reminderAt ? String(record.reminderAt).trim() : '',
    reminderReason: record.reminderReason ? String(record.reminderReason).trim() : '',
    notes: record.notes ? String(record.notes).trim() : '',
    campaignId: record.campaignId ? String(record.campaignId).trim() : DEFAULT_CAMPAIGN_ID,
    campaignHistory: history
  });
}

export function getAutoBackupMeta() {
  try {
    const raw = localStorage.getItem(BACKUP_META_KEY);
    if (!raw) {
      return { changesSinceExport: 0, lastAutoBackupAt: 0, lastExportAt: 0 };
    }
    const parsed = JSON.parse(raw);
    return {
      changesSinceExport: Number(parsed.changesSinceExport) > 0 ? Number(parsed.changesSinceExport) : 0,
      lastAutoBackupAt: Number(parsed.lastAutoBackupAt) > 0 ? Number(parsed.lastAutoBackupAt) : 0,
      lastExportAt: Number(parsed.lastExportAt) > 0 ? Number(parsed.lastExportAt) : 0
    };
  } catch (error) {
    return { changesSinceExport: 0, lastAutoBackupAt: 0, lastExportAt: 0 };
  }
}

export function resetAutoBackupCounter() {
  const current = getAutoBackupMeta();
  const next = { changesSinceExport: 0, lastAutoBackupAt: current.lastAutoBackupAt, lastExportAt: Date.now() };
  try {
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify(next));
  } catch (error) {
    return next;
  }
  return next;
}

function syncMirrorSnapshot(records, incrementChanges) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(records));
    const meta = getAutoBackupMeta();
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify({
      changesSinceExport: incrementChanges ? meta.changesSinceExport + 1 : meta.changesSinceExport,
      lastAutoBackupAt: Date.now(),
      lastExportAt: meta.lastExportAt
    }));
  } catch (error) {
    return;
  }
}

function readMirrorSnapshot() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeRecord) : [];
  } catch (error) {
    return [];
  }
}

function getDbConnection() {
  if (dbConnectionPromise) {
    return dbConnectionPromise;
  }
  dbConnectionPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = (event) => {
      const db = event.target.result;
      db.onversionchange = () => { db.close(); dbConnectionPromise = null; };
      resolve(db);
    };
    request.onerror = (event) => { dbConnectionPromise = null; reject(event.target.error); };
  });
  return dbConnectionPromise;
}

async function refreshMirrorFromDb(incrementChanges) {
  const db = await getDbConnection();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const records = (Array.isArray(req.result) ? req.result : []).map(normalizeRecord);
      records.sort((a, b) => b.updatedAt - a.updatedAt);
      syncMirrorSnapshot(records, incrementChanges);
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllLeads() {
  const db = await getDbConnection();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = async () => {
      const rawRecords = Array.isArray(request.result) ? request.result : [];
      if (rawRecords.length === 0) {
        const mirrorRecords = readMirrorSnapshot();
        if (mirrorRecords.length > 0) {
          await mergeImportedLeads(mirrorRecords);
          resolve(mirrorRecords);
          return;
        }
      }
      const records = rawRecords.map(normalizeRecord);
      records.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(records);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveLead(leadData, options) {
  const cleanPhone = normalizePhone(leadData.phone);
  if (cleanPhone.length < 7) {
    throw new Error('Ingresa un número de teléfono válido.');
  }
  const db = await getDbConnection();
  const saved = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const listRequest = store.getAll();
    listRequest.onsuccess = () => {
      const allRecords = Array.isArray(listRequest.result) ? listRequest.result : [];
      const duplicate = allRecords.find((item) => normalizePhone(item.phone) === cleanPhone && item.id !== leadData.id);
      if (duplicate) {
        if (options && options.skipDuplicate) {
          resolve({ skipped: true, existing: duplicate });
          return;
        }
        reject(new Error('El número +' + cleanPhone + ' ya está registrado como "' + duplicate.name + '".'));
        return;
      }
      const now = Date.now();
      const suffix = Math.random().toString(36).slice(2, 7);
      const record = normalizeRecord(Object.assign({}, leadData, {
        id: leadData.id ? leadData.id : 'lead_' + now + '_' + suffix,
        name: leadData.name.trim(),
        phone: cleanPhone,
        lastContactAt: leadData.lastContactAt ? leadData.lastContactAt : now,
        campaignId: leadData.campaignId ? leadData.campaignId : DEFAULT_CAMPAIGN_ID,
        createdAt: leadData.createdAt ? leadData.createdAt : now,
        updatedAt: now
      }));
      const putRequest = store.put(record);
      putRequest.onsuccess = () => resolve(record);
      putRequest.onerror = () => reject(putRequest.error);
    };
    listRequest.onerror = () => reject(listRequest.error);
  });
  if (saved && !saved.skipped) {
    await refreshMirrorFromDb(true);
  }
  return saved;
}

async function updateSingleLead(leadId, updaterFn) {
  const db = await getDbConnection();
  const updated = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(leadId);
    getReq.onsuccess = () => {
      if (!getReq.result) { resolve(null); return; }
      const record = normalizeRecord(getReq.result);
      const now = Date.now();
      updaterFn(record, now);
      record.updatedAt = now;
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
  if (updated) {
    await refreshMirrorFromDb(true);
  }
  return updated;
}

export function updateLeadRubro(leadId, newRubro) {
  return updateSingleLead(leadId, (record) => {
    record.rubro = newRubro ? String(newRubro).trim().toLowerCase() : '';
  });
}

export function addTagToLead(leadId, tagData) {
  return updateSingleLead(leadId, (record, now) => {
    const sentTimestamp = Number(tagData.sentAt) > 0 ? Number(tagData.sentAt) : now;
    const nextTags = record.sentTags.filter((item) => item.id !== tagData.id);
    nextTags.push({
      id: String(tagData.id),
      label: tagData.label ? String(tagData.label).trim() : String(tagData.id),
      sentAt: sentTimestamp
    });
    record.sentTags = nextTags;
    record.lastContactAt = sentTimestamp;
  });
}

export function removeTagFromLead(leadId, tagId) {
  return updateSingleLead(leadId, (record) => {
    record.sentTags = record.sentTags.filter((item) => item.id !== tagId);
  });
}

export function toggleInterestTag(leadId, tagObj) {
  return updateSingleLead(leadId, (record, now) => {
    const exists = record.interestTags.some((item) => item.id === tagObj.id);
    if (exists) {
      record.interestTags = record.interestTags.filter((item) => item.id !== tagObj.id);
    } else {
      record.interestTags.push({ id: String(tagObj.id), label: String(tagObj.label).trim(), taggedAt: now });
    }
    record.lastContactAt = now;
  });
}

export function addQuickNoteToLead(leadId, noteText) {
  const cleanText = noteText ? String(noteText).trim() : '';
  if (!cleanText) {
    return Promise.resolve(null);
  }
  return updateSingleLead(leadId, (record, now) => {
    record.quickNotes.unshift({
      id: 'note_' + now + '_' + Math.random().toString(36).slice(2, 6),
      text: cleanText,
      createdAt: now
    });
    record.lastContactAt = now;
  });
}

export function removeQuickNoteFromLead(leadId, noteId) {
  if (!noteId) {
    return Promise.resolve(null);
  }
  return updateSingleLead(leadId, (record) => {
    record.quickNotes = record.quickNotes.filter((item) => item.id !== noteId);
  });
}

export function updateLeadReminder(leadId, reminderAt, reminderReason) {
  return updateSingleLead(leadId, (record) => {
    record.reminderAt = reminderAt ? String(reminderAt).trim() : '';
    record.reminderReason = reminderReason ? String(reminderReason).trim() : '';
  });
}

async function mutateAllRecords(mutatorFn) {
  const db = await getDbConnection();
  const count = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const listReq = store.getAll();
    listReq.onsuccess = () => {
      const records = Array.isArray(listReq.result) ? listReq.result : [];
      const now = Date.now();
      let updatedCount = 0;
      records.forEach((raw) => {
        const record = normalizeRecord(raw);
        if (mutatorFn(record, now)) {
          store.put(record);
          updatedCount += 1;
        }
      });
      tx.oncomplete = () => resolve(updatedCount);
      tx.onerror = () => reject(tx.error);
    };
    listReq.onerror = () => reject(listReq.error);
  });
  if (count > 0) {
    await refreshMirrorFromDb(true);
  }
  return count;
}

export function renameTagAcrossLeads(tagId, newLabel) {
  const cleanLabel = newLabel ? String(newLabel).trim() : '';
  if (!tagId ? true : !cleanLabel) { return Promise.resolve(0); }
  return mutateAllRecords((record) => {
    let changed = false;
    record.sentTags = record.sentTags.map((tag) => {
      if (tag.id === tagId && tag.label !== cleanLabel) {
        changed = true;
        return Object.assign({}, tag, { label: cleanLabel });
      }
      return tag;
    });
    return changed;
  });
}

export function renameInterestTagAcrossLeads(tagId, newLabel) {
  const cleanLabel = newLabel ? String(newLabel).trim() : '';
  if (!tagId ? true : !cleanLabel) { return Promise.resolve(0); }
  return mutateAllRecords((record) => {
    let changed = false;
    record.interestTags = record.interestTags.map((tag) => {
      if (tag.id === tagId && tag.label !== cleanLabel) {
        changed = true;
        return Object.assign({}, tag, { label: cleanLabel });
      }
      return tag;
    });
    return changed;
  });
}

export function removeInterestTagAcrossLeads(tagId) {
  if (!tagId) { return Promise.resolve(0); }
  return mutateAllRecords((record) => {
    const before = record.interestTags.length;
    record.interestTags = record.interestTags.filter((tag) => tag.id !== tagId);
    return record.interestTags.length !== before;
  });
}

export function bulkAssignTagByStatuses(statuses, tagData) {
  const targetSet = Array.isArray(statuses) ? statuses : [];
  if (targetSet.length === 0) { return Promise.resolve(0); }
  return mutateAllRecords((record, now) => {
    if (targetSet.indexOf(record.status) === -1) { return false; }
    if (record.sentTags.some((t) => t.id === tagData.id)) { return false; }
    const tagTime = Number(tagData.sentAt) > 0 ? Number(tagData.sentAt) : now;
    record.sentTags.push({
      id: String(tagData.id),
      label: tagData.label ? String(tagData.label).trim() : String(tagData.id),
      sentAt: tagTime
    });
    record.lastContactAt = tagTime;
    record.updatedAt = now;
    return true;
  });
}

export function bulkUpdateByIds(leadIds, mutatorFn) {
  const idList = Array.isArray(leadIds) ? leadIds : [];
  if (idList.length === 0) { return Promise.resolve(0); }
  return mutateAllRecords((record, now) => {
    if (idList.indexOf(record.id) === -1) { return false; }
    const changed = mutatorFn(record, now);
    if (changed) { record.updatedAt = now; return true; }
    return false;
  });
}

export function archiveAndStartNewCampaign(newCampaignId, newCampaignName) {
  return mutateAllRecords((record, now) => {
    if (record.status !== 'nuevo' ? true : (record.sentTags.length > 0 ? true : record.interestTags.length > 0)) {
      record.campaignHistory.push({
        campaignId: record.campaignId,
        campaignName: newCampaignName ? 'Anterior a ' + newCampaignName : 'Campaña previa',
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
    record.saleAmount = 0;
    record.reminderAt = '';
    record.reminderReason = '';
    record.updatedAt = now;
    return true;
  });
}

export async function mergeImportedLeads(incomingLeads) {
  const list = Array.isArray(incomingLeads) ? incomingLeads : [];
  if (list.length === 0) { return { added: 0, updated: 0 }; }
  const db = await getDbConnection();
  const stats = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      const existingList = (Array.isArray(getAllReq.result) ? getAllReq.result : []).map(normalizeRecord);
      const byPhone = {};
      existingList.forEach((item) => { byPhone[normalizePhone(item.phone)] = item; });
      let added = 0;
      let updated = 0;
      list.forEach((raw) => {
        const cleanPhone = normalizePhone(raw.phone);
        if (cleanPhone.length < 7) { return; }
        const incoming = normalizeRecord(Object.assign({}, raw, { phone: cleanPhone }));
        const current = byPhone[cleanPhone];
        if (!current) {
          const id = incoming.id ? incoming.id : 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
          const fresh = Object.assign({}, incoming, { id: id, createdAt: incoming.createdAt ? incoming.createdAt : Date.now(), updatedAt: Date.now() });
          store.put(fresh);
          byPhone[cleanPhone] = fresh;
          added += 1;
        } else {
          const merged = Object.assign({}, current, incoming, {
            id: current.id,
            rubro: incoming.rubro ? incoming.rubro : current.rubro,
            notes: incoming.notes ? incoming.notes : current.notes,
            campaignHistory: incoming.campaignHistory.length >= current.campaignHistory.length ? incoming.campaignHistory : current.campaignHistory,
            updatedAt: Date.now()
          });
          store.put(merged);
          byPhone[cleanPhone] = merged;
          updated += 1;
        }
      });
      tx.oncomplete = () => resolve({ added: added, updated: updated });
      tx.onerror = () => reject(tx.error);
    };
    getAllReq.onerror = () => reject(getAllReq.error);
  });
  await refreshMirrorFromDb(true);
  return stats;
}

export async function deleteLead(id) {
  const db = await getDbConnection();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
  await refreshMirrorFromDb(true);
  return true;
}
