import { normalizePhone, normalizeInstagram } from './lead-schema.js';
import { isCapacitorNative } from './whatsapp-service.js';

const NATIVE_BACKUP_FOLDER = 'CRM-BLAP-Respaldos';
const EXPLICIT_SEPARATORS = [' - ', ' – ', ' — ', '\t', ';', ',', ': '];

function formatBackupTimestamp(dateObj) {
  const pad = (num) => (num < 10 ? '0' + num : String(num));
  const year = dateObj.getFullYear();
  const month = pad(dateObj.getMonth() + 1);
  const day = pad(dateObj.getDate());
  const hours = pad(dateObj.getHours());
  const minutes = pad(dateObj.getMinutes());
  return year + '-' + month + '-' + day + '-' + hours + '-' + minutes;
}

function getCapacitorPlugin(pluginName) {
  if (typeof window === 'undefined') { return null; }
  if (!(window.Capacitor && window.Capacitor.Plugins)) { return null; }
  return window.Capacitor.Plugins[pluginName] ? window.Capacitor.Plugins[pluginName] : null;
}

function resolveDirectoryConst(dirName) {
  if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Directory) {
    if (dirName === 'DOCUMENTS' && window.Capacitor.Directory.Documents) {
      return window.Capacitor.Directory.Documents;
    }
    if (dirName === 'CACHE' && window.Capacitor.Directory.Cache) {
      return window.Capacitor.Directory.Cache;
    }
  }
  return dirName;
}

async function writeNativeBackupFile(fsPlugin, fileName, jsonString, preferredDirs, subFolder) {
  let lastError = null;
  for (let i = 0; i < preferredDirs.length; i += 1) {
    const dirKey = preferredDirs[i];
    const dirValue = resolveDirectoryConst(dirKey);
    const targetPath = (dirKey === 'DOCUMENTS' && subFolder) ? subFolder + '/' + fileName : fileName;
    try {
      if (dirKey === 'DOCUMENTS' && typeof fsPlugin.requestPermissions === 'function') {
        try {
          await fsPlugin.requestPermissions();
        } catch (permErr) {
          /* Android 11+ puede no requerir permiso para Documents propios */
        }
      }
      const res = await fsPlugin.writeFile({
        path: targetPath,
        data: jsonString,
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
      const folderLabel = dirKey === 'DOCUMENTS' ? 'Documentos' : 'Cache';
      const basePath = folderLabel + '/' + targetPath;
      const displayPath = uri ? basePath + ' (' + uri + ')' : basePath;
      return {
        fileName: fileName,
        path: targetPath,
        directory: dirValue,
        uri: uri,
        displayPath: displayPath,
        usedFallback: i > 0
      };
    } catch (err) {
      lastError = err;
    }
  }
  const msg = lastError && lastError.message ? lastError.message : 'Error de escritura en almacenamiento';
  throw new Error('No se pudo guardar el respaldo en el dispositivo: ' + msg);
}

export function buildBackupPayload(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats) {
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    activeCampaignId: activeCampaignId ? String(activeCampaignId) : '',
    leads: Array.isArray(leads) ? leads : [],
    templates: Array.isArray(templates) ? templates : [],
    campaigns: Array.isArray(campaigns) ? campaigns : [],
    interestTagsCatalog: Array.isArray(interestTagsCatalog) ? interestTagsCatalog : [],
    channelStats: channelStats && typeof channelStats === 'object' ? channelStats : null
  };
}

export async function downloadBackupFile(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats) {
  const payload = buildBackupPayload(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats);
  const jsonString = JSON.stringify(payload, null, 2);
  const fileName = 'respaldo-crm-' + formatBackupTimestamp(new Date()) + '.json';

  if (isCapacitorNative()) {
    const fsPlugin = getCapacitorPlugin('Filesystem');
    if (fsPlugin && typeof fsPlugin.writeFile === 'function') {
      const saved = await writeNativeBackupFile(fsPlugin, fileName, jsonString, ['DOCUMENTS', 'CACHE'], NATIVE_BACKUP_FOLDER);
      return Object.assign({ native: true }, saved);
    }
  }

  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
  return { native: false, fileName: fileName, path: fileName, displayPath: fileName, usedFallback: false };
}

export async function shareBackupFile(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats) {
  const payload = buildBackupPayload(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats);
  const jsonString = JSON.stringify(payload, null, 2);
  const fileName = 'respaldo-crm-' + formatBackupTimestamp(new Date()) + '.json';

  if (isCapacitorNative()) {
    const fsPlugin = getCapacitorPlugin('Filesystem');
    const sharePlugin = getCapacitorPlugin('Share');
    if (fsPlugin && typeof fsPlugin.writeFile === 'function' && sharePlugin && typeof sharePlugin.share === 'function') {
      const saved = await writeNativeBackupFile(fsPlugin, fileName, jsonString, ['CACHE'], '');
      try {
        await sharePlugin.share({
          title: 'Respaldo CRM Prospección',
          text: 'Copia de seguridad con ' + payload.leads.length + ' contactos.',
          files: saved.uri ? [saved.uri] : [],
          dialogTitle: 'Compartir respaldo JSON'
        });
        return { shared: true, native: true, fileName: fileName, uri: saved.uri, displayPath: saved.displayPath };
      } catch (error) {
        const msg = error && error.message ? String(error.message) : '';
        const isAbort = error && error.name === 'AbortError';
        if (isAbort ? true : /cancel/i.test(msg)) {
          return { shared: false, cancelled: true, native: true, fileName: fileName };
        }
        throw error;
      }
    }
  }

  if (typeof File !== 'undefined' && typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
    const fileObj = new File([jsonString], fileName, { type: 'application/json' });
    if (navigator.canShare({ files: [fileObj] })) {
      try {
        await navigator.share({
          title: 'Respaldo CRM Prospección',
          text: 'Copia de seguridad con ' + payload.leads.length + ' contactos.',
          files: [fileObj]
        });
        return { shared: true, native: false, fileName: fileName };
      } catch (error) {
        if (error && error.name === 'AbortError') {
          return { shared: false, cancelled: true, native: false, fileName: fileName };
        }
      }
    }
  }

  const fallbackRes = await downloadBackupFile(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats);
  return Object.assign({ shared: false, fallbackDownload: true }, fallbackRes);
}

export async function copyBackupJsonToClipboard(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats) {
  const payload = buildBackupPayload(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats);
  const jsonString = JSON.stringify(payload, null, 2);

  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(jsonString);
      return { copied: true, bytes: jsonString.length, leadsCount: payload.leads.length };
    } catch (err) {
      /* Fallback DOM para WebViews restringidos */
    }
  }

  if (typeof document !== 'undefined' && document.body) {
    const ta = document.createElement('textarea');
    ta.value = jsonString;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    if (typeof ta.setSelectionRange === 'function') {
      ta.setSelectionRange(0, jsonString.length);
    }
    const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    document.body.removeChild(ta);
    if (ok) {
      return { copied: true, bytes: jsonString.length, leadsCount: payload.leads.length };
    }
  }

  throw new Error('No se pudo copiar el JSON al portapapeles.');
}

export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No se seleccionó ningún archivo.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const parsedVer = Number(parsed.version);
        resolve({
          version: !Number.isNaN(parsedVer) && parsedVer > 0 ? parsedVer : 1,
          activeCampaignId: parsed.activeCampaignId ? String(parsed.activeCampaignId) : '',
          leads: Array.isArray(parsed.leads) ? parsed.leads : [],
          templates: Array.isArray(parsed.templates) ? parsed.templates : [],
          campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
          interestTagsCatalog: Array.isArray(parsed.interestTagsCatalog) ? parsed.interestTagsCatalog : [],
          channelStats: parsed.channelStats && typeof parsed.channelStats === 'object' ? parsed.channelStats : null
        });
      } catch (error) {
        reject(new Error('El archivo seleccionado no es un respaldo JSON válido.'));
      }
    };
    reader.onerror = () => {
      reject(new Error('Error al leer el archivo desde el dispositivo.'));
    };
    reader.readAsText(file);
  });
}

function isInstagramToken(token) {
  const lower = token.trim().toLowerCase();
  if (lower.startsWith('@')) {
    return normalizeInstagram(lower).length >= 2;
  }
  const hasIgDomain = lower.indexOf('instagram.com/') !== -1 ? true : lower.indexOf('instagr.am/') !== -1;
  return hasIgDomain ? normalizeInstagram(lower).length >= 2 : false;
}

function isPhoneToken(token) {
  const clean = token.trim();
  if (!clean) { return false; }
  if (/[a-zA-Z]/.test(clean)) { return false; }
  return normalizePhone(clean).length >= 7;
}

function splitByKnownSeparators(line) {
  for (let i = 0; i < EXPLICIT_SEPARATORS.length; i += 1) {
    const sep = EXPLICIT_SEPARATORS[i];
    if (line.indexOf(sep) !== -1) {
      return line.split(sep).map((s) => s.trim()).filter((s) => s.length > 0);
    }
  }
  return null;
}

function hasValidChannelValues(phone, instagram) {
  return phone.length >= 7 ? true : instagram.length >= 2;
}

function extractLineParts(line) {
  const segments = splitByKnownSeparators(line);
  if (segments && segments.length >= 2) {
    let phone = '';
    let instagram = '';
    const nameParts = [];
    segments.forEach((seg) => {
      if (!instagram && isInstagramToken(seg)) {
        instagram = normalizeInstagram(seg);
        return;
      }
      if (!phone && isPhoneToken(seg)) {
        phone = normalizePhone(seg);
        return;
      }
      nameParts.push(seg);
    });
    const cleanName = nameParts.join(' - ').trim();
    if (cleanName && hasValidChannelValues(phone, instagram)) {
      return { name: cleanName, phone: phone, instagram: instagram };
    }
  }

  let working = line;
  let extractedIg = '';
  const igTail = working.match(/^(.*?)\s+(@[a-zA-Z0-9._]{2,})$/);
  if (igTail && igTail[1].trim()) {
    extractedIg = normalizeInstagram(igTail[2]);
    working = igTail[1].trim();
  }

  let extractedPhone = '';
  const phoneTail = working.match(/^(.*?)\s+(\+?\d[\d\s\-()]{6,}\d)$/);
  if (phoneTail && phoneTail[1].trim() && normalizePhone(phoneTail[2]).length >= 7) {
    extractedPhone = normalizePhone(phoneTail[2]);
    working = phoneTail[1].trim();
  }

  if (working && hasValidChannelValues(extractedPhone, extractedIg)) {
    return { name: working, phone: extractedPhone, instagram: extractedIg };
  }

  const dashIdx = line.lastIndexOf('-');
  if (dashIdx > 0) {
    const right = line.slice(dashIdx + 1).trim();
    const left = line.slice(0, dashIdx).trim();
    if (left && isInstagramToken(right)) {
      return { name: left, phone: '', instagram: normalizeInstagram(right) };
    }
    if (left && normalizePhone(right).length >= 7) {
      return { name: left, phone: normalizePhone(right), instagram: '' };
    }
  }
  return null;
}

export function parseBulkLeadsText(rawText, defaultRubro) {
  if (!rawText) { return []; }
  const cleanRubro = defaultRubro ? String(defaultRubro).trim().toLowerCase() : '';
  const lines = String(rawText).split(/\r?\n/);
  const parsedLeads = [];

  lines.forEach((rawLine) => {
    let cleanLine = String(rawLine).trim();
    cleanLine = cleanLine.replace(/^\d+[.)\-]\s+/, '');
    cleanLine = cleanLine.replace(/^[\-*•]\s+/, '').trim();
    if (!cleanLine) { return; }
    const parts = extractLineParts(cleanLine);
    if (!parts) { return; }
    const hasPhone = parts.phone.length >= 7;
    const hasIg = parts.instagram.length >= 2;
    if (parts.name && (hasPhone ? true : hasIg)) {
      parsedLeads.push({
        name: parts.name,
        phone: hasPhone ? parts.phone : '',
        instagram: hasIg ? parts.instagram : '',
        rubro: cleanRubro,
        stage: 'nuevo',
        baseNotes: ''
      });
    }
  });

  return parsedLeads;
}

export function evaluateBackupHealth(meta) {
  const changes = meta && Number(meta.changesSinceExport) > 0 ? Number(meta.changesSinceExport) : 0;
  if (meta && meta.mirrorQuotaExceeded) {
    return {
      changes: changes,
      needsExport: true,
      statusLabel: 'Alerta: Memoria espejo llena · Exporta JSON'
    };
  }
  const needsExport = changes >= 20;
  let statusLabel = 'Auto-Backup interno activo';
  if (needsExport) {
    statusLabel = 'Alerta: ' + changes + ' cambios sin exportar JSON';
  } else if (changes > 0) {
    statusLabel = 'Auto-Backup OK · ' + changes + '/20 cambios';
  }
  return {
    changes: changes,
    needsExport: needsExport,
    statusLabel: statusLabel
  };
}
