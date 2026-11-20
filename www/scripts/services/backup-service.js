import { normalizePhone } from './lead-schema.js';
import { isCapacitorNative } from './whatsapp-service.js';

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
  if (typeof window === 'undefined' || !window.Capacitor || !window.Capacitor.Plugins) {
    return null;
  }
  return window.Capacitor.Plugins[pluginName] || null;
}

async function writeNativeBackupFile(fsPlugin, fileName, jsonString, preferredDirs) {
  let lastError = null;
  for (let i = 0; i < preferredDirs.length; i += 1) {
    const dir = preferredDirs[i];
    try {
      if (dir === 'DOCUMENTS' && typeof fsPlugin.requestPermissions === 'function') {
        try {
          await fsPlugin.requestPermissions();
        } catch (permErr) {
          /* Android 11+ puede no requerir permiso para documentos propios */
        }
      }
      const res = await fsPlugin.writeFile({
        path: fileName,
        data: jsonString,
        directory: dir,
        encoding: 'utf8',
        recursive: true
      });
      let uri = res && res.uri ? String(res.uri) : '';
      if (!uri && typeof fsPlugin.getUri === 'function') {
        try {
          const uriRes = await fsPlugin.getUri({ path: fileName, directory: dir });
          uri = uriRes && uriRes.uri ? String(uriRes.uri) : '';
        } catch (uriErr) {
          uri = '';
        }
      }
      const folderLabel = dir === 'DOCUMENTS' ? 'Documentos' : 'Cache';
      const displayPath = uri ? folderLabel + '/' + fileName + ' (' + uri + ')' : folderLabel + '/' + fileName;
      return {
        fileName: fileName,
        directory: dir,
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

export function buildBackupPayload(leads, templates, campaigns, interestTagsCatalog, activeCampaignId) {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    activeCampaignId: activeCampaignId ? String(activeCampaignId) : '',
    leads: Array.isArray(leads) ? leads : [],
    templates: Array.isArray(templates) ? templates : [],
    campaigns: Array.isArray(campaigns) ? campaigns : [],
    interestTagsCatalog: Array.isArray(interestTagsCatalog) ? interestTagsCatalog : []
  };
}

export async function downloadBackupFile(leads, templates, campaigns, interestTagsCatalog, activeCampaignId) {
  const payload = buildBackupPayload(leads, templates, campaigns, interestTagsCatalog, activeCampaignId);
  const jsonString = JSON.stringify(payload, null, 2);
  const fileName = 'respaldo-crm-' + formatBackupTimestamp(new Date()) + '.json';

  if (isCapacitorNative()) {
    const fsPlugin = getCapacitorPlugin('Filesystem');
    if (fsPlugin && typeof fsPlugin.writeFile === 'function') {
      const saved = await writeNativeBackupFile(fsPlugin, fileName, jsonString, ['DOCUMENTS', 'CACHE']);
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
  return { native: false, fileName: fileName, displayPath: fileName, usedFallback: false };
}

export async function shareBackupFile(leads, templates, campaigns, interestTagsCatalog, activeCampaignId) {
  const payload = buildBackupPayload(leads, templates, campaigns, interestTagsCatalog, activeCampaignId);
  const jsonString = JSON.stringify(payload, null, 2);
  const fileName = 'respaldo-crm-' + formatBackupTimestamp(new Date()) + '.json';

  if (isCapacitorNative()) {
    const fsPlugin = getCapacitorPlugin('Filesystem');
    const sharePlugin = getCapacitorPlugin('Share');
    if (fsPlugin && typeof fsPlugin.writeFile === 'function' && sharePlugin && typeof sharePlugin.share === 'function') {
      const saved = await writeNativeBackupFile(fsPlugin, fileName, jsonString, ['CACHE']);
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
        if ((error && error.name === 'AbortError') || /cancel/i.test(msg)) {
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

  const fallbackRes = await downloadBackupFile(leads, templates, campaigns, interestTagsCatalog, activeCampaignId);
  return Object.assign({ shared: false, fallbackDownload: true }, fallbackRes);
}

export async function copyBackupJsonToClipboard(leads, templates, campaigns, interestTagsCatalog, activeCampaignId) {
  const payload = buildBackupPayload(leads, templates, campaigns, interestTagsCatalog, activeCampaignId);
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
        resolve({
          version: Number(parsed.version) || 1,
          activeCampaignId: parsed.activeCampaignId ? String(parsed.activeCampaignId) : '',
          leads: Array.isArray(parsed.leads) ? parsed.leads : [],
          templates: Array.isArray(parsed.templates) ? parsed.templates : [],
          campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
          interestTagsCatalog: Array.isArray(parsed.interestTagsCatalog) ? parsed.interestTagsCatalog : []
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

function extractLineParts(line) {
  const separators = [' - ', ' – ', ' — ', ': ', ',', ';', '\t'];
  for (let i = 0; i < separators.length; i += 1) {
    const sep = separators[i];
    const idx = line.lastIndexOf(sep);
    if (idx > 0) {
      return {
        name: line.slice(0, idx).trim(),
        phone: line.slice(idx + sep.length).trim()
      };
    }
  }

  const tailMatch = line.match(/^(.*?)\s+(\+?\d[\d\s\-()]{6,}\d)$/);
  if (tailMatch && tailMatch[1].trim() && normalizePhone(tailMatch[2]).length >= 7) {
    return {
      name: tailMatch[1].trim(),
      phone: tailMatch[2].trim()
    };
  }

  const dashIdx = line.lastIndexOf('-');
  if (dashIdx > 0) {
    const right = line.slice(dashIdx + 1).trim();
    if (normalizePhone(right).length >= 7) {
      return {
        name: line.slice(0, dashIdx).trim(),
        phone: right
      };
    }
  }
  return null;
}

export function parseBulkLeadsText(rawText, defaultRubro) {
  if (!rawText) {
    return [];
  }
  const cleanRubro = defaultRubro ? String(defaultRubro).trim().toLowerCase() : '';
  const lines = String(rawText).split(/\r?\n/);
  const parsedLeads = [];

  lines.forEach((rawLine) => {
    const cleanLine = rawLine.replace(/^(?:\d+[\.\)\-]\s+|[\-\*\•]\s+)/, '').trim();
    if (!cleanLine) {
      return;
    }
    const parts = extractLineParts(cleanLine);
    if (!parts) {
      return;
    }
    const cleanPhone = normalizePhone(parts.phone);
    if (parts.name && cleanPhone.length >= 7) {
      parsedLeads.push({
        name: parts.name,
        phone: cleanPhone,
        rubro: cleanRubro,
        status: 'nuevo',
        notes: ''
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
