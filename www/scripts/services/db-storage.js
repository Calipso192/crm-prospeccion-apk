import { DEFAULT_CAMPAIGN_ID, normalizeMasterRecord } from './lead-schema.js';

export const STORE_NAME = 'leads';

const DB_NAME = 'crm_prospeccion_db';
const DB_VERSION = 4;
const MIRROR_KEY = 'crm_prospeccion_leads_mirror_v4';
const LEGACY_MIRROR_KEY = 'crm_prospeccion_leads_mirror_v2';
const BACKUP_META_KEY = 'crm_prospeccion_backup_meta_v2';
const MIRROR_MAX_RECORDS = 250;

let dbConnectionPromise = null;
let writeQueue = Promise.resolve();
let mirrorQuotaExceededMem = false;

export function enqueueWrite(taskFn) {
  const run = writeQueue.then(taskFn, taskFn);
  writeQueue = run.catch(() => {});
  return run;
}

export function waitForWriteQueue() {
  return writeQueue;
}

function defaultBackupMeta() {
  return {
    changesSinceExport: 0,
    lastAutoBackupAt: 0,
    lastExportAt: 0,
    mirrorQuotaExceeded: mirrorQuotaExceededMem,
    mirrorDisabledForScale: false,
    totalCount: 0,
    explicitlyEmpty: false
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
      mirrorQuotaExceeded: Boolean(p.mirrorQuotaExceeded ? true : mirrorQuotaExceededMem),
      mirrorDisabledForScale: Boolean(p.mirrorDisabledForScale),
      totalCount: Number(p.totalCount) > 0 ? Number(p.totalCount) : 0,
      explicitlyEmpty: Boolean(p.explicitlyEmpty)
    };
  } catch (error) {
    return defaultBackupMeta();
  }
}

function writeBackupMeta(meta) {
  try {
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify(meta));
  } catch (e) {
    return;
  }
}

export function resetAutoBackupCounter() {
  const next = Object.assign({}, getAutoBackupMeta(), {
    changesSinceExport: 0,
    lastExportAt: Date.now()
  });
  writeBackupMeta(next);
  return next;
}

export function syncMirrorSnapshot(records, incrementChanges) {
  const meta = getAutoBackupMeta();
  const nextChanges = incrementChanges ? meta.changesSinceExport + 1 : meta.changesSinceExport;
  let quotaFailed = false;
  let nextAutoAt = meta.lastAutoBackupAt;
  const scaleMode = records.length > MIRROR_MAX_RECORDS;

  if (scaleMode) {
    try {
      localStorage.removeItem(MIRROR_KEY);
      localStorage.removeItem(LEGACY_MIRROR_KEY);
    } catch (e) {
      /* Ignorar si localStorage no está disponible */
    }
    nextAutoAt = Date.now();
  } else {
    try {
      localStorage.setItem(MIRROR_KEY, JSON.stringify(records));
      nextAutoAt = Date.now();
    } catch (error) {
      quotaFailed = true;
    }
  }

  mirrorQuotaExceededMem = quotaFailed;
  writeBackupMeta({
    changesSinceExport: nextChanges,
    lastAutoBackupAt: nextAutoAt,
    lastExportAt: meta.lastExportAt,
    mirrorQuotaExceeded: quotaFailed,
    mirrorDisabledForScale: scaleMode,
    totalCount: records.length,
    explicitlyEmpty: records.length === 0
  });
}

export function readMirrorSnapshot(fallbackCampaignId) {
  try {
    const rawV4 = localStorage.getItem(MIRROR_KEY);
    const raw = rawV4 ? rawV4 : localStorage.getItem(LEGACY_MIRROR_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const targetCid = fallbackCampaignId ? fallbackCampaignId : DEFAULT_CAMPAIGN_ID;
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeMasterRecord(item, targetCid, { forceFallbackForLegacy: !rawV4 }))
      : [];
  } catch (error) {
    return [];
  }
}

export function getDbConnection() {
  if (dbConnectionPromise) { return dbConnectionPromise; }
  dbConnectionPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const store = !db.objectStoreNames.contains(STORE_NAME)
        ? db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        : (request.transaction ? request.transaction : event.target.transaction).objectStore(STORE_NAME);
      ['status', 'updatedAt', 'phone', 'campaignId', 'instagram'].forEach((idx) => {
        if (!store.indexNames.contains(idx)) {
          store.createIndex(idx, idx, { unique: false });
        }
      });
    };
    request.onsuccess = (event) => {
      const db = event.target.result;
      db.onversionchange = () => {
        db.close();
        dbConnectionPromise = null;
      };
      resolve(db);
    };
    request.onerror = (event) => {
      dbConnectionPromise = null;
      reject(event.target.error);
    };
  });
  return dbConnectionPromise;
}

export function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function runTx(mode, bodyFn) {
  const db = await getDbConnection();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ? tx.error : new Error('Transacción cancelada'));
    bodyFn(tx.objectStore(STORE_NAME), (val) => { result = val; }, reject);
  });
}

export async function readAllRawFromDb() {
  const db = await getDbConnection();
  const raw = await idbReq(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
  return Array.isArray(raw) ? raw : [];
}

export async function refreshMirrorFromDb(incrementChanges, fallbackCampaignId) {
  const raw = await readAllRawFromDb();
  const targetCid = fallbackCampaignId ? fallbackCampaignId : DEFAULT_CAMPAIGN_ID;
  const records = raw.map((item) => normalizeMasterRecord(item, targetCid));
  records.sort((a, b) => b.updatedAt - a.updatedAt);
  syncMirrorSnapshot(records, incrementChanges);
  return records;
}
