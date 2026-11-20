import {
  DEFAULT_CAMPAIGN_ID, normalizePhone, normalizeStatus,
  normalizeRecord, mergeLeadRecords, applySentTagToLead, applyArchiveToLead
} from './lead-schema.js';

export { normalizePhone, normalizeRecord };

const DB_NAME = 'crm_prospeccion_db';
const DB_VERSION = 3;
const STORE_NAME = 'leads';
const MIRROR_KEY = 'crm_prospeccion_leads_mirror_v2';
const BACKUP_META_KEY = 'crm_prospeccion_backup_meta_v2';

let dbConnectionPromise = null;
let writeQueue = Promise.resolve();
let mirrorQuotaExceededMem = false;

function enqueueWrite(taskFn) {
  const run = writeQueue.then(taskFn, taskFn);
  writeQueue = run.catch(() => {});
  return run;
}

function defaultBackupMeta() {
  return {
    changesSinceExport: 0, lastAutoBackupAt: 0, lastExportAt: 0,
    mirrorQuotaExceeded: mirrorQuotaExceededMem, explicitlyEmpty: false
  };
}

export function getAutoBackupMeta() {
  try {
    const raw = localStorage.getItem(BACKUP_META_KEY);
    if (!raw) { return defaultBackupMeta(); }
    const p = JSON.parse(raw);
    return {
      changesSinceExport: Number(p.changesSinceExport) > 0 ? Number(p.changesSinceExport) : 0,
      lastAutoBackupAt: Number(p.lastAutoBackupAt) > 0 ? Number(p.lastAutoBackupAt) : 0,
      lastExportAt: Number(p.lastExportAt) > 0 ? Number(p.lastExportAt) : 0,
      mirrorQuotaExceeded: Boolean(p.mirrorQuotaExceeded || mirrorQuotaExceededMem),
      explicitlyEmpty: Boolean(p.explicitlyEmpty)
    };
  } catch (error) {
    return defaultBackupMeta();
  }
}

function writeBackupMeta(meta) {
  try { localStorage.setItem(BACKUP_META_KEY, JSON.stringify(meta)); } catch (e) { return; }
}

export function resetAutoBackupCounter() {
  const next = Object.assign({}, getAutoBackupMeta(), { changesSinceExport: 0, lastExportAt: Date.now() });
  writeBackupMeta(next);
  return next;
}

function syncMirrorSnapshot(records, incrementChanges) {
  const meta = getAutoBackupMeta();
  const nextChanges = incrementChanges ? meta.changesSinceExport + 1 : meta.changesSinceExport;
  let quotaFailed = false;
  let nextAutoAt = meta.lastAutoBackupAt;
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(records));
    nextAutoAt = Date.now();
  } catch (error) {
    quotaFailed = true;
  }
  mirrorQuotaExceededMem = quotaFailed;
  writeBackupMeta({
    changesSinceExport: nextChanges, lastAutoBackupAt: nextAutoAt,
    lastExportAt: meta.lastExportAt, mirrorQuotaExceeded: quotaFailed, explicitlyEmpty: records.length === 0
  });
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
  if (dbConnectionPromise) { return dbConnectionPromise; }
  dbConnectionPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const store = !db.objectStoreNames.contains(STORE_NAME)
        ? db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        : (request.transaction || event.target.transaction).objectStore(STORE_NAME);
      ['status', 'updatedAt', 'phone', 'campaignId'].forEach((idx) => {
        if (!store.indexNames.contains(idx)) { store.createIndex(idx, idx, { unique: false }); }
      });
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

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function runTx(mode, bodyFn) {
  const db = await getDbConnection();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transacción cancelada'));
    bodyFn(tx.objectStore(STORE_NAME), (val) => { result = val; }, reject);
  });
}

async function _refreshMirrorFromDb(incrementChanges) {
  const db = await getDbConnection();
  const raw = await idbReq(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
  const records = (Array.isArray(raw) ? raw : []).map(normalizeRecord);
  records.sort((a, b) => b.updatedAt - a.updatedAt);
  syncMirrorSnapshot(records, incrementChanges);
  return records;
}

function findPhoneMatchesInTx(store, cleanPhone) {
  const queries = [cleanPhone];
  if (cleanPhone.length === 11 && cleanPhone.startsWith('51')) { queries.push(cleanPhone.slice(2)); }
  const phoneIndex = store.index('phone');
  return Promise.all(queries.map((q) => idbReq(phoneIndex.getAll(q)).then((res) => (Array.isArray(res) ? res : []))))
    .then((groups) => groups.flat());
}

async function _mergeImportedLeadsCore(incomingLeads, options) {
  const list = Array.isArray(incomingLeads) ? incomingLeads : [];
  if (list.length === 0) { return { added: 0, updated: 0 }; }
  const stats = await runTx('readwrite', (store, setResult) => {
    store.getAll().onsuccess = (ev) => {
      const byPhone = new Map();
      (Array.isArray(ev.target.result) ? ev.target.result : []).map(normalizeRecord).forEach((item) => {
        if (item.phone) { byPhone.set(item.phone, item); }
      });
      const now = Date.now();
      let added = 0;
      let updated = 0;
      list.forEach((raw, idx) => {
        const cleanPhone = normalizePhone(raw && raw.phone);
        if (cleanPhone.length < 7) { return; }
        const incoming = normalizeRecord(Object.assign({}, raw, { phone: cleanPhone }));
        const current = byPhone.get(cleanPhone);
        if (!current) {
          const id = incoming.id ? String(incoming.id) : 'lead_' + now + '_' + idx + '_' + Math.random().toString(36).slice(2, 7);
          const createdAt = Number(incoming.createdAt) > 0 ? Number(incoming.createdAt) : now;
          const updatedAt = Number(incoming.updatedAt) > 0 ? Number(incoming.updatedAt) : createdAt;
          const fresh = normalizeRecord(Object.assign({}, incoming, { id, createdAt, updatedAt }));
          store.put(fresh);
          byPhone.set(cleanPhone, fresh);
          added += 1;
        } else {
          const merged = mergeLeadRecords(current, incoming);
          store.put(merged);
          byPhone.set(cleanPhone, merged);
          updated += 1;
        }
      });
      setResult({ added, updated });
    };
  });
  await _refreshMirrorFromDb(!(options && options.skipIncrementChanges));
  return stats;
}

async function _updateSingleLeadCore(leadId, updaterFn) {
  const updated = await runTx('readwrite', (store, setResult) => {
    store.get(leadId).onsuccess = (ev) => {
      if (!ev.target.result) { setResult(null); return; }
      const record = normalizeRecord(ev.target.result);
      const now = Date.now();
      updaterFn(record, now);
      record.updatedAt = now;
      store.put(record);
      setResult(record);
    };
  });
  if (updated) { await _refreshMirrorFromDb(true); }
  return updated;
}

async function _mutateAllRecordsCore(mutatorFn, options) {
  const count = await runTx('readwrite', (store, setResult) => {
    store.getAll().onsuccess = (ev) => {
      const now = Date.now();
      let updatedCount = 0;
      (Array.isArray(ev.target.result) ? ev.target.result : []).forEach((raw) => {
        const record = normalizeRecord(raw);
        if (mutatorFn(record, now)) { store.put(record); updatedCount += 1; }
      });
      setResult(updatedCount);
    };
  });
  if (count > 0) { await _refreshMirrorFromDb(!(options && options.skipIncrementChanges)); }
  return count;
}

export async function getAllLeads() {
  await writeQueue;
  const db = await getDbConnection();
  const raw = await idbReq(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
  const rawRecords = Array.isArray(raw) ? raw : [];
  if (rawRecords.length === 0) {
    const meta = getAutoBackupMeta();
    if (!meta.explicitlyEmpty && !meta.mirrorQuotaExceeded) {
      const mirrorRecords = readMirrorSnapshot();
      if (mirrorRecords.length > 0) {
        await enqueueWrite(() => _mergeImportedLeadsCore(mirrorRecords, { skipIncrementChanges: true }));
        mirrorRecords.sort((a, b) => b.updatedAt - a.updatedAt);
        return mirrorRecords;
      }
    }
  }
  const records = rawRecords.map(normalizeRecord);
  records.sort((a, b) => b.updatedAt - a.updatedAt);
  return records;
}

export function saveLead(leadData, options) {
  const cleanPhone = normalizePhone(leadData && leadData.phone);
  if (cleanPhone.length < 7) { return Promise.reject(new Error('Ingresa un número de teléfono válido.')); }
  return enqueueWrite(async () => {
    const db = await getDbConnection();
    const saved = await new Promise((resolve, reject) => {
      const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
      findPhoneMatchesInTx(store, cleanPhone).then((matches) => {
        const duplicate = matches.find((item) => item.id !== leadData.id);
        if (duplicate) {
          if (options && options.skipDuplicate) { resolve({ skipped: true, existing: duplicate }); return; }
          reject(new Error('El número +' + cleanPhone + ' ya está registrado como "' + duplicate.name + '".'));
          return;
        }
        const now = Date.now();
        const record = normalizeRecord(Object.assign({}, leadData, {
          id: leadData.id ? leadData.id : 'lead_' + now + '_' + Math.random().toString(36).slice(2, 7),
          name: leadData.name.trim(), phone: cleanPhone,
          lastContactAt: leadData.lastContactAt ? leadData.lastContactAt : now,
          campaignId: leadData.campaignId ? leadData.campaignId : DEFAULT_CAMPAIGN_ID,
          createdAt: leadData.createdAt ? leadData.createdAt : now, updatedAt: now
        }));
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve(record);
        putReq.onerror = () => reject(putReq.error);
      }).catch(reject);
    });
    if (saved && !saved.skipped) { await _refreshMirrorFromDb(true); }
    return saved;
  });
}

export function bulkInsertLeads(leadsList, options) {
  const list = Array.isArray(leadsList) ? leadsList : [];
  if (list.length === 0) { return Promise.resolve({ added: 0, skipped: 0 }); }
  const campaignId = options && options.defaultCampaignId ? options.defaultCampaignId : DEFAULT_CAMPAIGN_ID;
  return enqueueWrite(async () => {
    const stats = await runTx('readwrite', (store, setResult) => {
      store.getAll().onsuccess = (ev) => {
        const existingPhones = new Set();
        (Array.isArray(ev.target.result) ? ev.target.result : []).forEach((item) => {
          const p = normalizePhone(item && item.phone);
          if (p) { existingPhones.add(p); }
        });
        const now = Date.now();
        let added = 0;
        let skipped = 0;
        list.forEach((raw, idx) => {
          const cleanPhone = normalizePhone(raw && raw.phone);
          if (cleanPhone.length < 7 || !raw.name) { return; }
          if (existingPhones.has(cleanPhone)) { skipped += 1; return; }
          store.put(normalizeRecord(Object.assign({}, raw, {
            id: 'lead_' + now + '_' + idx + '_' + Math.random().toString(36).slice(2, 7),
            name: String(raw.name).trim(), phone: cleanPhone,
            campaignId: raw.campaignId ? raw.campaignId : campaignId,
            lastContactAt: now, createdAt: now, updatedAt: now
          })));
          existingPhones.add(cleanPhone);
          added += 1;
        });
        setResult({ added, skipped });
      };
    });
    if (stats.added > 0) { await _refreshMirrorFromDb(true); }
    return stats;
  });
}

export function updateLeadRubro(leadId, newRubro) {
  return enqueueWrite(() => _updateSingleLeadCore(leadId, (record) => {
    record.rubro = newRubro ? String(newRubro).trim().toLowerCase() : '';
  }));
}

export function addTagToLead(leadId, tagData) {
  return enqueueWrite(() => _updateSingleLeadCore(leadId, (record, now) => {
    const sentTs = Number(tagData.sentAt) > 0 ? Number(tagData.sentAt) : now;
    applySentTagToLead(record, tagData, sentTs, true);
  }));
}

export function applyLeadWhatsAppOutcome(leadId, newStatus, pendingTpl) {
  return enqueueWrite(() => _updateSingleLeadCore(leadId, (record, now) => {
    record.status = normalizeStatus(newStatus);
    if (record.status !== 'vendido') { record.saleAmount = 0; }
    if (record.status === 'contactado' && pendingTpl && pendingTpl.id) {
      applySentTagToLead(record, pendingTpl, now, false);
    }
    record.lastContactAt = now;
  }));
}

export function removeTagFromLead(leadId, tagId) {
  return enqueueWrite(() => _updateSingleLeadCore(leadId, (record) => {
    record.sentTags = record.sentTags.filter((item) => item.id !== tagId);
  }));
}

export function toggleInterestTag(leadId, tagObj) {
  return enqueueWrite(() => _updateSingleLeadCore(leadId, (record, now) => {
    const exists = record.interestTags.some((item) => item.id === tagObj.id);
    record.interestTags = exists
      ? record.interestTags.filter((item) => item.id !== tagObj.id)
      : record.interestTags.concat([{ id: String(tagObj.id), label: String(tagObj.label).trim(), taggedAt: now }]);
    record.lastContactAt = now;
  }));
}

export function addQuickNoteToLead(leadId, noteText) {
  const cleanText = noteText ? String(noteText).trim() : '';
  if (!cleanText) { return Promise.resolve(null); }
  return enqueueWrite(() => _updateSingleLeadCore(leadId, (record, now) => {
    record.quickNotes.unshift({
      id: 'note_' + now + '_' + Math.random().toString(36).slice(2, 6),
      text: cleanText, createdAt: now
    });
    record.lastContactAt = now;
  }));
}

export function removeQuickNoteFromLead(leadId, noteId) {
  if (!noteId) { return Promise.resolve(null); }
  return enqueueWrite(() => _updateSingleLeadCore(leadId, (record) => {
    record.quickNotes = record.quickNotes.filter((item) => item.id !== noteId);
  }));
}

export function updateLeadReminder(leadId, reminderAt, reminderReason) {
  return enqueueWrite(() => _updateSingleLeadCore(leadId, (record) => {
    record.reminderAt = reminderAt ? String(reminderAt).trim() : '';
    record.reminderReason = reminderReason ? String(reminderReason).trim() : '';
  }));
}

export function syncAllTagLabels(labelsMap) {
  const map = labelsMap && typeof labelsMap === 'object' ? labelsMap : {};
  if (Object.keys(map).length === 0) { return Promise.resolve(0); }
  return enqueueWrite(() => _mutateAllRecordsCore((record) => {
    let changed = false;
    record.sentTags = record.sentTags.map((tag) => {
      const nextLabel = map[tag.id];
      if (nextLabel && tag.label !== nextLabel) { changed = true; return Object.assign({}, tag, { label: nextLabel }); }
      return tag;
    });
    return changed;
  }, { skipIncrementChanges: true }));
}

export function renameTagAcrossLeads(tagId, newLabel) {
  const cleanLabel = newLabel ? String(newLabel).trim() : '';
  return (!tagId || !cleanLabel) ? Promise.resolve(0) : syncAllTagLabels({ [tagId]: cleanLabel });
}

export function renameInterestTagAcrossLeads(tagId, newLabel) {
  const cleanLabel = newLabel ? String(newLabel).trim() : '';
  if (!tagId || !cleanLabel) { return Promise.resolve(0); }
  return enqueueWrite(() => _mutateAllRecordsCore((record) => {
    let changed = false;
    record.interestTags = record.interestTags.map((tag) => {
      if (tag.id === tagId && tag.label !== cleanLabel) { changed = true; return Object.assign({}, tag, { label: cleanLabel }); }
      return tag;
    });
    return changed;
  }));
}

export function removeInterestTagAcrossLeads(tagId) {
  if (!tagId) { return Promise.resolve(0); }
  return enqueueWrite(() => _mutateAllRecordsCore((record) => {
    const before = record.interestTags.length;
    record.interestTags = record.interestTags.filter((tag) => tag.id !== tagId);
    return record.interestTags.length !== before;
  }));
}

export function bulkAssignTagByStatuses(statuses, tagData) {
  const targetSet = Array.isArray(statuses) ? statuses : [];
  if (targetSet.length === 0 || !tagData || !tagData.id) { return Promise.resolve(0); }
  return enqueueWrite(() => _mutateAllRecordsCore((record, now) => {
    if (targetSet.indexOf(record.status) === -1 || record.sentTags.some((t) => t.id === tagData.id)) { return false; }
    const tagTime = Number(tagData.sentAt) > 0 ? Number(tagData.sentAt) : now;
    applySentTagToLead(record, tagData, tagTime, true);
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
          const record = normalizeRecord(ev.target.result);
          if (mutatorFn(record, now)) { record.updatedAt = now; store.put(record); count += 1; setResult(count); }
        };
      });
      setResult(0);
    });
    if (updatedCount > 0) { await _refreshMirrorFromDb(true); }
    return updatedCount;
  });
}

export function archiveAndStartNewCampaign(newCampaignId, previousCampaignName) {
  return enqueueWrite(async () => {
    const clearedReminderLeadIds = [];
    const updatedCount = await _mutateAllRecordsCore((record, now) => {
      if (applyArchiveToLead(record, newCampaignId, previousCampaignName, now)) {
        clearedReminderLeadIds.push(record.id);
      }
      return true;
    });
    return { updatedCount, clearedReminderLeadIds };
  });
}

export function mergeImportedLeads(incomingLeads, options) {
  return enqueueWrite(() => _mergeImportedLeadsCore(incomingLeads, options));
}

export function deleteLead(id) {
  return enqueueWrite(async () => {
    await runTx('readwrite', (store) => { store.delete(id); });
    await _refreshMirrorFromDb(true);
    return true;
  });
}
