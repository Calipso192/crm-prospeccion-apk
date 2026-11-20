import {
  bulkInsertLeads,
  mergeImportedLeads,
  resetAutoBackupCounter
} from '../services/db-service.js';

export {
  syncCampaignFilterOptions,
  renderTemplatesEditor,
  createNewTemplate,
  renderManualTagOptions,
  applyBulkTagSelection
} from './template-modal-ui.js';

let toastTimer = null;

export function showAppToast(text, isError) {
  if (typeof document === 'undefined') {
    return;
  }
  const toastEl = document.getElementById('app-toast');
  if (!toastEl) {
    return;
  }
  toastEl.textContent = text;
  toastEl.classList.toggle('toast-error', Boolean(isError));
  toastEl.classList.remove('hidden');
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 5500);
}

function showModalFeedback(el, text, isError) {
  if (el) {
    el.textContent = text;
    el.classList.remove('hidden');
  }
  showAppToast(text, isError);
}

async function getExportArgs(leads) {
  const tplMod = await import('../services/template-service.js');
  const phaseMod = await import('../services/phase-engine.js');
  const chanMod = await import('../services/channel-service.js');
  return [
    leads,
    tplMod.getTemplates('all'),
    tplMod.getCampaigns(),
    phaseMod.getInterestTagsCatalog(),
    tplMod.getActiveCampaignId(),
    chanMod.exportChannelStats()
  ];
}

export async function exportBackupJson(leads, feedbackEl) {
  try {
    const backupMod = await import('../services/backup-service.js');
    const args = await getExportArgs(leads);
    const res = await backupMod.downloadBackupFile(...args);
    resetAutoBackupCounter();
    const loc = res && res.displayPath ? res.displayPath : (res && res.fileName ? res.fileName : 'respaldo.json');
    const prefix = res && res.usedFallback
      ? 'Respaldo guardado en Cache (Documentos restringido): '
      : 'Respaldo guardado en: ';
    showModalFeedback(feedbackEl, prefix + loc, false);
  } catch (error) {
    showModalFeedback(feedbackEl, error && error.message ? error.message : 'Error al exportar respaldo.', true);
  }
}

export async function shareBackupJson(leads, feedbackEl) {
  try {
    const backupMod = await import('../services/backup-service.js');
    const args = await getExportArgs(leads);
    const result = await backupMod.shareBackupFile(...args);
    if (result && result.cancelled) {
      return;
    }
    resetAutoBackupCounter();
    if (result && result.shared) {
      showModalFeedback(feedbackEl, 'Respaldo compartido correctamente.', false);
    } else {
      const loc = result && result.displayPath ? result.displayPath : (result ? result.fileName : 'respaldo.json');
      showModalFeedback(feedbackEl, 'Respaldo guardado en: ' + loc, false);
    }
  } catch (error) {
    showModalFeedback(feedbackEl, error && error.message ? error.message : 'Error al compartir respaldo.', true);
  }
}

export async function copyBackupJson(leads, feedbackEl) {
  try {
    const backupMod = await import('../services/backup-service.js');
    const args = await getExportArgs(leads);
    const res = await backupMod.copyBackupJsonToClipboard(...args);
    resetAutoBackupCounter();
    showModalFeedback(
      feedbackEl,
      'JSON copiado al portapapeles (' + res.leadsCount + ' contactos). Pégalo en Notas o WhatsApp.',
      false
    );
  } catch (error) {
    showModalFeedback(feedbackEl, error && error.message ? error.message : 'No se pudo copiar el JSON.', true);
  }
}

export async function importBackupJson(file, feedbackEl, onComplete) {
  if (!file) {
    return;
  }
  try {
    const backupMod = await import('../services/backup-service.js');
    const tplMod = await import('../services/template-service.js');
    const phaseMod = await import('../services/phase-engine.js');
    const chanMod = await import('../services/channel-service.js');
    const data = await backupMod.readBackupFile(file);

    const campStats = tplMod.mergeCampaigns(data.campaigns, data.activeCampaignId);
    const tplStats = tplMod.mergeTemplates(data.templates);
    const intStats = phaseMod.mergeInterestTagsCatalog(data.interestTagsCatalog, data.leads);
    if (data.channelStats) {
      chanMod.mergeChannelStats(data.channelStats);
    }
    const knownCampaignIds = tplMod.getCampaigns().map((c) => c.id);
    const mergeStats = await mergeImportedLeads(data.leads, {
      defaultCampaignId: tplMod.getActiveCampaignId(),
      knownCampaignIds: knownCampaignIds
    });

    if (onComplete) {
      await onComplete();
    }
    const parts = [mergeStats.added + ' contactos nuevos', mergeStats.updated + ' actualizados'];
    if (campStats.added > 0) {
      parts.push(campStats.added + ' campañas');
    }
    if (tplStats.added + tplStats.updated > 0) {
      parts.push((tplStats.added + tplStats.updated) + ' plantillas');
    }
    if (intStats.added + intStats.updated > 0) {
      parts.push((intStats.added + intStats.updated) + ' etiquetas');
    }
    showModalFeedback(feedbackEl, 'Fusión completada: ' + parts.join(', ') + '.', false);
  } catch (error) {
    showModalFeedback(feedbackEl, error.message, true);
  }
}

export async function importBulkLeads(textareaEl, rubroSelectEl, feedbackEl, onComplete) {
  const backupMod = await import('../services/backup-service.js');
  const tplMod = await import('../services/template-service.js');
  const defaultRubro = rubroSelectEl ? rubroSelectEl.value : '';
  const parsedList = backupMod.parseBulkLeadsText(textareaEl.value, defaultRubro);
  if (parsedList.length === 0) {
    showModalFeedback(
      feedbackEl,
      'No se detectaron contactos válidos. Usa: Nombre - 9XXXXXXXX, Nombre - @usuario o Nombre - 9XXXXXXXX - @usuario',
      true
    );
    return;
  }
  const stats = await bulkInsertLeads(parsedList, {
    defaultCampaignId: tplMod.getActiveCampaignId()
  });
  textareaEl.value = '';
  if (onComplete) {
    await onComplete();
  }
  const extra = stats.skipped > 0 ? ' (' + stats.skipped + ' ya existentes omitidos).' : '.';
  showModalFeedback(feedbackEl, 'Se agregaron ' + stats.added + ' prospectos a esta campaña' + extra, false);
}
