function formatBackupTimestamp(dateObj) {
  const pad = (num) => (num < 10 ? '0' + num : String(num));
  const year = dateObj.getFullYear();
  const month = pad(dateObj.getMonth() + 1);
  const day = pad(dateObj.getDate());
  const hours = pad(dateObj.getHours());
  const minutes = pad(dateObj.getMinutes());
  return year + '-' + month + '-' + day + '-' + hours + '-' + minutes;
}

export function buildBackupPayload(leads, templates, campaigns) {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    leads: Array.isArray(leads) ? leads : [],
    templates: Array.isArray(templates) ? templates : [],
    campaigns: Array.isArray(campaigns) ? campaigns : []
  };
}

export function downloadBackupFile(leads, templates, campaigns) {
  const payload = buildBackupPayload(leads, templates, campaigns);
  const jsonString = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const timeTag = formatBackupTimestamp(new Date());
  const fileName = 'respaldo-crm-' + timeTag + '.json';
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
  return fileName;
}

export async function shareBackupFile(leads, templates, campaigns) {
  const payload = buildBackupPayload(leads, templates, campaigns);
  const jsonString = JSON.stringify(payload, null, 2);
  const timeTag = formatBackupTimestamp(new Date());
  const fileName = 'respaldo-crm-' + timeTag + '.json';

  if (typeof File !== 'undefined' && navigator.share && navigator.canShare) {
    const fileObj = new File([jsonString], fileName, { type: 'application/json' });
    if (navigator.canShare({ files: [fileObj] })) {
      try {
        await navigator.share({
          title: 'Respaldo CRM Prospección',
          text: 'Copia de seguridad con ' + payload.leads.length + ' contactos.',
          files: [fileObj]
        });
        return { shared: true, fileName: fileName };
      } catch (error) {
        if (error && error.name === 'AbortError') {
          return { shared: false, cancelled: true, fileName: fileName };
        }
      }
    }
  }

  downloadBackupFile(leads, templates, campaigns);
  return { shared: false, fallbackDownload: true, fileName: fileName };
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
        const validLeads = Array.isArray(parsed.leads) ? parsed.leads : [];
        const validTemplates = Array.isArray(parsed.templates) ? parsed.templates : [];
        const validCampaigns = Array.isArray(parsed.campaigns) ? parsed.campaigns : [];
        resolve({
          leads: validLeads,
          templates: validTemplates,
          campaigns: validCampaigns
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

function normalizePhoneDigits(rawPhone) {
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) {
    return '51' + digits;
  }
  return digits;
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
  const dashIdx = line.lastIndexOf('-');
  if (dashIdx > 0) {
    return {
      name: line.slice(0, dashIdx).trim(),
      phone: line.slice(dashIdx + 1).trim()
    };
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
    const cleanLine = rawLine.replace(/^[\d\.\)\-\*\•\s]+/, '').trim();
    if (!cleanLine) {
      return;
    }
    const parts = extractLineParts(cleanLine);
    if (!parts) {
      return;
    }
    const cleanPhone = normalizePhoneDigits(parts.phone);
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
