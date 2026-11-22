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
    const prefix = res && res.native && res.usedFallback
      ? 'Respaldo guardado en ruta alterna: '
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

export async function exportDedupeIndexJson(leads, feedbackEl) {
  try {
    const dedupeMod = await import('../services/dedupe-index-service.js');
    const tplMod = await import('../services/template-service.js');
    const res = await dedupeMod.downloadDedupeIndexFile(leads, tplMod.getActiveCampaignId());
    const loc = res && res.displayPath ? res.displayPath : 'crm_blap_index.json';
    showModalFeedback(feedbackEl, 'Índice Termux exportado (' + res.count + ' contactos): ' + loc, false);
  } catch (error) {
    showModalFeedback(feedbackEl, error && error.message ? error.message : 'Error al exportar índice.', true);
  }
}

export async function importNightBatchJson(file, rubroSelectEl, feedbackEl, onComplete) {
  if (!file) { return; }
  try {
    const rawText = await file.text();
    const parserMod = await import('../services/bulk-parser.js');
    const tplMod = await import('../services/template-service.js');
    const defaultRubro = rubroSelectEl ? rubroSelectEl.value : '';
    const parsedList = parserMod.parseNightBatchJson(rawText, defaultRubro);
    if (parsedList.length === 0) {
      showModalFeedback(feedbackEl, 'El archivo JSON no contiene prospectos válidos.', true);
      return;
    }
    const stats = await bulkInsertLeads(parsedList, {
      defaultCampaignId: tplMod.getActiveCampaignId()
    });
    if (onComplete) { await onComplete(); }
    const extra = stats.skipped > 0 ? ' (' + stats.skipped + ' duplicados omitidos).' : '.';
    showModalFeedback(feedbackEl, 'Buzón nocturno: ' + stats.added + ' prospectos agregados' + extra, false);
  } catch (error) {
    showModalFeedback(feedbackEl, error && error.message ? error.message : 'Error al leer el lote JSON.', true);
  }
}

export async function importBulkLeads(textareaEl, rubroSelectEl, feedbackEl, onComplete) {
  const parserMod = await import('../services/bulk-parser.js');
  const tplMod = await import('../services/template-service.js');
  const defaultRubro = rubroSelectEl ? rubroSelectEl.value : '';
  const parsedList = parserMod.parseBulkLeadsText(textareaEl.value, defaultRubro);
  if (parsedList.length === 0) {
    showModalFeedback(
      feedbackEl,
      'No se detectaron contactos válidos. Usa: Nombre - 9XXXXXXXX - @usuario | Canal: WA | Nota: ...',
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

export async function linkWebBlapSyncFolder(feedbackEl) {
  try {
    const syncMod = await import('../services/blap-sync-service.js');
    await syncMod.linkWebBlapDirectory();
    showModalFeedback(feedbackEl, 'Carpeta Documents/BLAP-Sync/ y respaldos/ vinculada correctamente.', false);
  } catch (error) {
    if (error && error.name === 'AbortError') { return; }
    showModalFeedback(feedbackEl, error && error.message ? error.message : 'No se pudo vincular la carpeta.', true);
  }
}

export async function syncNightBatchFromBlap(rubroSelectEl, feedbackEl, onComplete) {
  try {
    const syncMod = await import('../services/blap-sync-service.js');
    const fileRes = await syncMod.readBlapSyncFile(syncMod.LEADS_INBOX_FILENAME, { promptIfMissing: true });
    if (!fileRes || !fileRes.text) {
      showModalFeedback(feedbackEl, 'No se encontró Documents/BLAP-Sync/' + syncMod.LEADS_INBOX_FILENAME + '.', true);
      return;
    }
    const parserMod = await import('../services/bulk-parser.js');
    const tplMod = await import('../services/template-service.js');
    const defaultRubro = rubroSelectEl ? rubroSelectEl.value : '';
    const parsedList = parserMod.parseNightBatchJson(fileRes.text, defaultRubro);
    if (parsedList.length === 0) {
      showModalFeedback(feedbackEl, 'El archivo leads_nuevos_ia.json no contiene prospectos válidos.', true);
      return;
    }
    const stats = await bulkInsertLeads(parsedList, { defaultCampaignId: tplMod.getActiveCampaignId() });
    if (onComplete) { await onComplete(); }
    const extra = stats.skipped > 0 ? ' (' + stats.skipped + ' duplicados omitidos).' : '.';
    showModalFeedback(feedbackEl, 'BLAP-Sync: ' + stats.added + ' prospectos agregados' + extra, false);
  } catch (error) {
    showModalFeedback(feedbackEl, error && error.message ? error.message : 'Error al sincronizar leads_nuevos_ia.json.', true);
  }
}

async function processJarvisPatchText(rawText, onComplete) {
  const patchMod = await import('../services/jarvis-patch-service.js');
  const res = await patchMod.applyJarvisPatchPayload(rawText);
  if (res.totalChanges > 0 && onComplete) {
    await onComplete();
  }
  return res;
}

export async function applyJarvisPatchFromBlap(feedbackEl, onComplete) {
  try {
    const syncMod = await import('../services/blap-sync-service.js');
    const fileRes = await syncMod.readBlapSyncFile(syncMod.JARVIS_PATCH_FILENAME, { promptIfMissing: true });
    if (fileRes && fileRes.permissionError) {
      showModalFeedback(feedbackEl, 'Sin permiso en Android para leer BLAP-Sync. Activa "Acceso a todos los archivos" para CRM BLAP en Ajustes.', true);
      return;
    }
    if (!fileRes || !fileRes.text) {
      showModalFeedback(feedbackEl, 'No se encontró Documents/BLAP-Sync/' + syncMod.JARVIS_PATCH_FILENAME + '.', true);
      return;
    }
    const res = await processJarvisPatchText(fileRes.text, onComplete);
    await syncMod.archiveBlapSyncFile(syncMod.JARVIS_PATCH_FILENAME, fileRes);
    showModalFeedback(feedbackEl, 'Parche Jarvis aplicado: ' + formatPatchSummary(res) + ' (' + res.skipped + ' omitidos).', false);
  } catch (error) {
    showModalFeedback(feedbackEl, error && error.message ? error.message : 'Error al aplicar jarvis_crm_patch.json.', true);
  }
}

export async function importJarvisPatchFile(file, feedbackEl, onComplete) {
  if (!file) { return; }
  try {
    const rawText = await file.text();
    const res = await processJarvisPatchText(rawText, onComplete);
    showModalFeedback(feedbackEl, 'Parche Jarvis aplicado: ' + res.totalChanges + ' cambios (' + res.skipped + ' omitidos).', false);
  } catch (error) {
    showModalFeedback(feedbackEl, error && error.message ? error.message : 'Error al leer el parche JSON.', true);
  }
}

let autoSyncRunning = false;
let lastAutoSyncAt = 0;
let permissionToastShown = false;

function formatPatchSummary(res) {
  const parts = [];
  if (res.added > 0) { parts.push(res.added + ' nuevos'); }
  if (res.updated > 0) { parts.push(res.updated + ' actualizados'); }
  if (res.discarded > 0) { parts.push(res.discarded + ' descartados'); }
  if (parts.length === 0) { return res.totalChanges + ' cambios'; }
  return parts.join(', ');
}

export async function runSilentCapacitorAutoSync(onComplete) {
  if (autoSyncRunning || (Date.now() - lastAutoSyncAt) < 3000) { return; }
  const waMod = await import('../services/whatsapp-service.js');
  if (!waMod.isCapacitorNative()) { return; }

  autoSyncRunning = true;
  try {
    const syncMod = await import('../services/blap-sync-service.js');
    let leadsAdded = 0;
    let patchChanges = 0;
    let patchDiscarded = 0;
    let forceBackup = false;
    let campaignChanged = false;

    const leadsFile = await syncMod.readBlapSyncFile(syncMod.LEADS_INBOX_FILENAME);
    if (leadsFile && leadsFile.permissionError) {
      if (!permissionToastShown) {
        permissionToastShown = true;
        showAppToast('Sin permiso en BLAP-Sync. Activa "Acceso a todos los archivos" para CRM BLAP en Ajustes.', true);
      }
      return;
    }
    if (leadsFile && leadsFile.text) {
      const parserMod = await import('../services/bulk-parser.js');
      const tplMod = await import('../services/template-service.js');
      const parsedList = parserMod.parseNightBatchJson(leadsFile.text, '');
      if (parsedList.length > 0) {
        const stats = await bulkInsertLeads(parsedList, { defaultCampaignId: tplMod.getActiveCampaignId() });
        leadsAdded = stats.added;
      }
      await syncMod.archiveBlapSyncFile(syncMod.LEADS_INBOX_FILENAME, leadsFile);
    }

    const patchFile = await syncMod.readBlapSyncFile(syncMod.JARVIS_PATCH_FILENAME);
    if (patchFile && patchFile.permissionError) {
      if (!permissionToastShown) {
        permissionToastShown = true;
        showAppToast('Sin permiso para leer jarvis_crm_patch.json. Activa "Acceso a todos los archivos" en Ajustes.', true);
      }
      return;
    }
    if (patchFile && patchFile.text) {
      const patchMod = await import('../services/jarvis-patch-service.js');
      const patchRes = await patchMod.applyJarvisPatchPayload(patchFile.text);
      patchChanges = patchRes.totalChanges;
      patchDiscarded = patchRes.discarded || 0;
      forceBackup = Boolean(patchRes.forceBackup);
      campaignChanged = Boolean(patchRes.campaignChanged);
      await syncMod.archiveBlapSyncFile(syncMod.JARVIS_PATCH_FILENAME, patchFile);
    }

    if (leadsAdded > 0 || patchChanges > 0 || forceBackup || campaignChanged) {
      if (onComplete) { await onComplete(); }
      const { getAllLeads } = await import('../services/db-service.js');
      const dedupeMod = await import('../services/dedupe-index-service.js');
      const backupMod = await import('../services/backup-service.js');
      const tplMod = await import('../services/template-service.js');
      const freshLeads = await getAllLeads();
      await dedupeMod.downloadDedupeIndexFile(freshLeads, tplMod.getActiveCampaignId());
      const args = await getExportArgs(freshLeads);
      await backupMod.downloadBackupFile(...args);
      resetAutoBackupCounter();
      const parts = [];
      if (leadsAdded > 0) { parts.push(leadsAdded + ' leads nuevos'); }
      if (patchChanges > 0) {
        const discTxt = patchDiscarded > 0 ? ' (' + patchDiscarded + ' descartados)' : '';
        parts.push(patchChanges + ' cambios' + discTxt);
      }
      if (forceBackup && parts.length === 0) { parts.push('respaldo actualizado'); }
      if (parts.length > 0) { showAppToast('Jarvis sincronizó ' + parts.join(' y '), false); }
    }
  } catch (err) {
    const errMsg = err && err.message ? err.message : 'Error al sincronizar BLAP-Sync';
    showAppToast('Auto-sync: ' + errMsg, true);
  } finally {
    lastAutoSyncAt = Date.now();
    autoSyncRunning = false;
  }
}
