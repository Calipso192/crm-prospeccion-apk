import { isCapacitorNative } from './whatsapp-service.js';

export const BLAP_SYNC_FOLDER = 'BLAP-Sync';
export const BLAP_RESPALDOS_SUBFOLDER = 'respaldos';
export const LEADS_INBOX_FILENAME = 'leads_nuevos_ia.json';
export const JARVIS_PATCH_FILENAME = 'jarvis_crm_patch.json';
export const DEDUPE_INDEX_FILENAME = 'crm_blap_index.json';

const HANDLE_DB_NAME = 'crm_blap_fs_handles_v1';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'blap_root_dir';

function pad2(num) {
  return num < 10 ? '0' + num : String(num);
}

export function formatSyncTimestamp(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  return [
    d.getFullYear(),
    pad2(d.getMonth() + 1),
    pad2(d.getDate()),
    pad2(d.getHours()),
    pad2(d.getMinutes()),
    pad2(d.getSeconds())
  ].join('-');
}

export function getCapacitorPlugin(pluginName) {
  if (typeof window === 'undefined') { return null; }
  if (!(window.Capacitor && window.Capacitor.Plugins)) { return null; }
  return window.Capacitor.Plugins[pluginName] ? window.Capacitor.Plugins[pluginName] : null;
}

export function resolveDirectoryConst(dirName) {
  if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Directory) {
    const dirEnum = window.Capacitor.Directory;
    if (dirName === 'EXTERNAL_STORAGE' && dirEnum.ExternalStorage) { return dirEnum.ExternalStorage; }
    if (dirName === 'DOCUMENTS' && dirEnum.Documents) { return dirEnum.Documents; }
    if (dirName === 'CACHE' && dirEnum.Cache) { return dirEnum.Cache; }
  }
  return dirName;
}

function getNativeDirCandidates() {
  return [
    { key: 'DOCUMENTS', basePath: BLAP_SYNC_FOLDER, label: 'Documents/' + BLAP_SYNC_FOLDER },
    { key: 'CACHE', basePath: BLAP_SYNC_FOLDER, label: 'Cache/' + BLAP_SYNC_FOLDER }
  ];
}

function joinPath(base, subFolder, fileName) {
  const parts = [];
  if (base) { parts.push(base); }
  if (subFolder) { parts.push(subFolder); }
  if (fileName) { parts.push(fileName); }
  return parts.join('/');
}

async function requestFsPermissionIfNeeded(fsPlugin, dirKey) {
  if (dirKey === 'CACHE' || typeof fsPlugin.requestPermissions !== 'function') { return; }
  try {
    await fsPlugin.requestPermissions();
  } catch (err) {
    /* Android 11+ puede resolver sin diálogo explícito */
  }
}

async function ensureNativeDir(fsPlugin, folderPath, dirValue) {
  if (!folderPath || typeof fsPlugin.mkdir !== 'function') { return; }
  try {
    await fsPlugin.mkdir({ path: folderPath, directory: dirValue, recursive: true });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (!/exist/i.test(msg)) {
      /* writeFile con recursive:true intentará crear la ruta igualmente */
    }
  }
}

export async function writeNativeBlapFile(subFolder, fileName, content, preferredKeys) {
  const fsPlugin = getCapacitorPlugin('Filesystem');
  if (!fsPlugin || typeof fsPlugin.writeFile !== 'function') {
    throw new Error('Plugin Filesystem de Capacitor no disponible.');
  }
  const allCandidates = getNativeDirCandidates();
  const candidates = Array.isArray(preferredKeys) && preferredKeys.length > 0
    ? allCandidates.filter((c) => preferredKeys.includes(c.key))
    : allCandidates;

  let lastError = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const cand = candidates[i];
    const dirValue = resolveDirectoryConst(cand.key);
    const folderPath = joinPath(cand.basePath, subFolder, '');
    const targetPath = joinPath(cand.basePath, subFolder, fileName);
    try {
      await requestFsPermissionIfNeeded(fsPlugin, cand.key);
      await ensureNativeDir(fsPlugin, cand.basePath, dirValue);
      if (subFolder) {
        await ensureNativeDir(fsPlugin, folderPath, dirValue);
      }
      const res = await fsPlugin.writeFile({
        path: targetPath,
        data: content,
        directory: dirValue,
        encoding: 'utf8',
        recursive: true
      });
      let uri = res && res.uri ? String(res.uri) : '';
      if (!uri && typeof fsPlugin.getUri === 'function') {
        try {
          const uriRes = await fsPlugin.getUri({ path: targetPath, directory: dirValue });
          uri = uriRes && uriRes.uri ? String(uriRes.uri) : '';
        } catch (uriErr) {
          uri = '';
        }
      }
      const baseDisplay = joinPath(cand.label, subFolder, fileName);
      return {
        native: true,
        webFs: false,
        fileName: fileName,
        path: targetPath,
        directory: dirValue,
        dirKey: cand.key,
        uri: uri,
        displayPath: uri ? baseDisplay + ' (' + uri + ')' : baseDisplay,
        usedFallback: cand.key !== 'DOCUMENTS'
      };
    } catch (err) {
      lastError = err;
    }
  }
  const msg = lastError && lastError.message ? lastError.message : 'Error de escritura en almacenamiento';
  throw new Error('No se pudo guardar el archivo en el dispositivo: ' + msg);
}

export async function writeNativeCacheTempFile(fileName, content) {
  const fsPlugin = getCapacitorPlugin('Filesystem');
  if (!fsPlugin || typeof fsPlugin.writeFile !== 'function') {
    throw new Error('Plugin Filesystem no disponible.');
  }
  const dirValue = resolveDirectoryConst('CACHE');
  const res = await fsPlugin.writeFile({
    path: fileName,
    data: content,
    directory: dirValue,
    encoding: 'utf8',
    recursive: true
  });
  let uri = res && res.uri ? String(res.uri) : '';
  if (!uri && typeof fsPlugin.getUri === 'function') {
    try {
      const uriRes = await fsPlugin.getUri({ path: fileName, directory: dirValue });
      uri = uriRes && uriRes.uri ? String(uriRes.uri) : '';
    } catch (e) {
      uri = '';
    }
  }
  return { fileName: fileName, uri: uri, displayPath: 'Cache/' + fileName };
}

async function readNativeBlapFile(fileName, subFolder) {
  const fsPlugin = getCapacitorPlugin('Filesystem');
  if (!fsPlugin || typeof fsPlugin.readFile !== 'function') { return null; }
  const candidates = getNativeDirCandidates().slice(0, 1);

  for (let i = 0; i < candidates.length; i += 1) {
    const cand = candidates[i];
    const dirValue = resolveDirectoryConst(cand.key);
    const targetPath = joinPath(cand.basePath, subFolder, fileName);
    try {
      await requestFsPermissionIfNeeded(fsPlugin, cand.key);
      await ensureNativeDir(fsPlugin, cand.basePath, dirValue);
      const res = await fsPlugin.readFile({
        path: targetPath,
        directory: dirValue,
        encoding: 'utf8'
      });
      if (res && typeof res.data === 'string') {
        return {
          text: res.data,
          path: targetPath,
          dirKey: cand.key,
          directory: dirValue,
          displayPath: joinPath(cand.label, subFolder, fileName)
        };
      }
    } catch (err) {
      /* Archivo no existe o directorio sin acceso; probar siguiente candidato */
    }
  }
  return null;
}

async function archiveNativeBlapFile(fileName, subFolder, dirKey) {
  const fsPlugin = getCapacitorPlugin('Filesystem');
  if (!fsPlugin) { return false; }
  const cand = getNativeDirCandidates().find((c) => c.key === dirKey) || getNativeDirCandidates()[0];
  const dirValue = resolveDirectoryConst(cand.key);
  const srcPath = joinPath(cand.basePath, subFolder, fileName);
  const archiveFolder = joinPath(cand.basePath, BLAP_RESPALDOS_SUBFOLDER, '');
  const archiveName = fileName.replace(/\.json$/i, '') + '_aplicado_' + formatSyncTimestamp(new Date()) + '.json';
  const destPath = joinPath(archiveFolder, '', archiveName);

  try {
    await ensureNativeDir(fsPlugin, archiveFolder, dirValue);
    if (typeof fsPlugin.rename === 'function') {
      await fsPlugin.rename({ from: srcPath, to: destPath, directory: dirValue, toDirectory: dirValue });
      return true;
    }
  } catch (err) {
    /* Si rename falla, intentar borrar */
  }
  try {
    if (typeof fsPlugin.deleteFile === 'function') {
      await fsPlugin.deleteFile({ path: srcPath, directory: dirValue });
      return true;
    }
  } catch (delErr) {
    return false;
  }
  return false;
}

/* --- Web File System Access API (con persistencia en IDB aislada) --- */

export function hasWebDirectoryPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function openHandleDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = indexedDB.open(HANDLE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Error abriendo handles DB'));
  });
}

async function getStoredWebHandle() {
  try {
    const db = await openHandleDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

async function saveStoredWebHandle(handle) {
  try {
    const db = await openHandleDb();
    await new Promise((resolve) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    /* Ignorar si IDB bloquea handles */
  }
}

async function verifyHandlePermission(handle, mode) {
  if (!handle) { return false; }
  const opts = { mode: mode || 'readwrite' };
  try {
    if (typeof handle.queryPermission === 'function') {
      if ((await handle.queryPermission(opts)) === 'granted') { return true; }
    }
    if (typeof handle.requestPermission === 'function') {
      if ((await handle.requestPermission(opts)) === 'granted') { return true; }
    }
  } catch (err) {
    return false;
  }
  return false;
}

async function ensureWebBlapDirs(rootHandle) {
  const syncHandle = rootHandle.name === BLAP_SYNC_FOLDER
    ? rootHandle
    : await rootHandle.getDirectoryHandle(BLAP_SYNC_FOLDER, { create: true });
  const respaldosHandle = await syncHandle.getDirectoryHandle(BLAP_RESPALDOS_SUBFOLDER, { create: true });
  return { syncHandle: syncHandle, respaldosHandle: respaldosHandle };
}

export async function linkWebBlapDirectory() {
  if (!hasWebDirectoryPicker()) {
    throw new Error('Tu navegador no soporta selección directa de carpetas. Se usarán descargas y selector de archivo.');
  }
  const picked = await window.showDirectoryPicker({
    id: 'blap-sync-dir',
    mode: 'readwrite',
    startIn: 'documents'
  });
  const dirs = await ensureWebBlapDirs(picked);
  await saveStoredWebHandle(dirs.syncHandle);
  return dirs;
}

async function resolveWebBlapDirs(promptIfMissing) {
  if (!hasWebDirectoryPicker()) { return null; }
  const stored = await getStoredWebHandle();
  if (stored && (await verifyHandlePermission(stored, 'readwrite'))) {
    try {
      return await ensureWebBlapDirs(stored);
    } catch (err) {
      /* Carpeta movida o eliminada, volver a pedir si aplica */
    }
  }
  if (!promptIfMissing) { return null; }
  try {
    return await linkWebBlapDirectory();
  } catch (err) {
    if (err && err.name === 'AbortError') { return null; }
    throw err;
  }
}

export function triggerBrowserDownload(fileName, content) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* --- API Unificada --- */

export async function writeBlapSyncFile(fileName, content, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const subFolder = opts.subFolder ? String(opts.subFolder) : '';

  if (isCapacitorNative()) {
    return writeNativeBlapFile(subFolder, fileName, content);
  }

  if (hasWebDirectoryPicker()) {
    const dirs = await resolveWebBlapDirs(opts.promptIfMissing !== false);
    if (dirs) {
      const targetDir = subFolder === BLAP_RESPALDOS_SUBFOLDER ? dirs.respaldosHandle : dirs.syncHandle;
      const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      const displayPath = joinPath('Documents/' + BLAP_SYNC_FOLDER, subFolder, fileName);
      return {
        native: false,
        webFs: true,
        fileName: fileName,
        path: displayPath,
        displayPath: displayPath,
        usedFallback: false
      };
    }
  }

  triggerBrowserDownload(fileName, content);
  return {
    native: false,
    webFs: false,
    fileName: fileName,
    path: fileName,
    displayPath: fileName + ' (descarga estándar del navegador)',
    usedFallback: true
  };
}

export async function readBlapSyncFile(fileName, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const subFolder = opts.subFolder ? String(opts.subFolder) : '';

  if (isCapacitorNative()) {
    return readNativeBlapFile(fileName, subFolder);
  }

  if (hasWebDirectoryPicker()) {
    const dirs = await resolveWebBlapDirs(Boolean(opts.promptIfMissing));
    if (!dirs) { return null; }
    const targetDir = subFolder === BLAP_RESPALDOS_SUBFOLDER ? dirs.respaldosHandle : dirs.syncHandle;
    try {
      const fileHandle = await targetDir.getFileHandle(fileName, { create: false });
      const file = await fileHandle.getFile();
      const text = await file.text();
      return {
        text: text,
        path: joinPath('Documents/' + BLAP_SYNC_FOLDER, subFolder, fileName),
        displayPath: joinPath('Documents/' + BLAP_SYNC_FOLDER, subFolder, fileName),
        webFs: true
      };
    } catch (err) {
      return null;
    }
  }

  return null;
}

export async function archiveBlapSyncFile(fileName, readResult) {
  if (!readResult) { return false; }
  if (isCapacitorNative()) {
    return archiveNativeBlapFile(fileName, '', readResult.dirKey);
  }
  if (readResult.webFs && hasWebDirectoryPicker()) {
    const dirs = await resolveWebBlapDirs(false);
    if (!dirs) { return false; }
    try {
      const archiveName = fileName.replace(/\.json$/i, '') + '_aplicado_' + formatSyncTimestamp(new Date()) + '.json';
      const destHandle = await dirs.respaldosHandle.getFileHandle(archiveName, { create: true });
      const writable = await destHandle.createWritable();
      await writable.write(readResult.text || '');
      await writable.close();
      await dirs.syncHandle.removeEntry(fileName);
      return true;
    } catch (err) {
      try {
        await dirs.syncHandle.removeEntry(fileName);
        return true;
      } catch (e) {
        return false;
      }
    }
  }
  return false;
}
