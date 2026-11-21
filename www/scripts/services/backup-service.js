import { isCapacitorNative } from './whatsapp-service.js';
import {
  BLAP_RESPALDOS_SUBFOLDER,
  getCapacitorPlugin,
  writeBlapSyncFile,
  writeNativeCacheTempFile
} from './blap-sync-service.js';
export { parseBulkLeadsText } from './bulk-parser.js';

function formatBackupTimestamp(dateObj) {
  const pad = (num) => (num < 10 ? '0' + num : String(num));
  const year = dateObj.getFullYear();
  const month = pad(dateObj.getMonth() + 1);
  const day = pad(dateObj.getDate());
  const hours = pad(dateObj.getHours());
  const minutes = pad(dateObj.getMinutes());
  return year + '-' + month + '-' + day + '-' + hours + '-' + minutes;
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

export async function saveJsonFileToDevice(fileName, jsonString, options) {
  return writeBlapSyncFile(fileName, jsonString, options);
}

export async function downloadBackupFile(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats) {
  const payload = buildBackupPayload(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats);
  const jsonString = JSON.stringify(payload, null, 2);
  const fileName = 'respaldo-crm-' + formatBackupTimestamp(new Date()) + '.json';
  return saveJsonFileToDevice(fileName, jsonString, { subFolder: BLAP_RESPALDOS_SUBFOLDER });
}

export async function shareBackupFile(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats) {
  const payload = buildBackupPayload(leads, templates, campaigns, interestTagsCatalog, activeCampaignId, channelStats);
  const jsonString = JSON.stringify(payload, null, 2);
  const fileName = 'respaldo-crm-' + formatBackupTimestamp(new Date()) + '.json';

  if (isCapacitorNative()) {
    const sharePlugin = getCapacitorPlugin('Share');
    if (sharePlugin && typeof sharePlugin.share === 'function') {
      const saved = await writeNativeCacheTempFile(fileName, jsonString);
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

export function evaluateBackupHealth(meta) {
  const changes = meta && Number(meta.changesSinceExport) > 0 ? Number(meta.changesSinceExport) : 0;
  if (meta && meta.mirrorQuotaExceeded && !meta.mirrorDisabledForScale) {
    return {
      changes: changes,
      needsExport: true,
      statusLabel: 'Alerta: Memoria espejo llena · Exporta JSON'
    };
  }
  const needsExport = changes >= 20;
  let statusLabel = meta && meta.mirrorDisabledForScale
    ? 'IndexedDB activo (Modo 10K)'
    : 'Auto-Backup interno activo';
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
