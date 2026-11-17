import {
  saveLead,
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

function showModalFeedback(el, text) {
  if (!el) {
    return;
  }
  el.textContent = text;
  el.classList.remove('hidden');
}

export async function exportBackupJson(leads, feedbackEl) {
  const backupMod = await import('../services/backup-service.js');
  const tplMod = await import('../services/template-service.js');
  const fileName = backupMod.downloadBackupFile(
    leads,
    tplMod.getTemplates('all'),
    tplMod.getCampaigns()
  );
  resetAutoBackupCounter();
  showModalFeedback(feedbackEl, 'Respaldo descargado: ' + fileName);
}

export async function shareBackupJson(leads, feedbackEl) {
  const backupMod = await import('../services/backup-service.js');
  const tplMod = await import('../services/template-service.js');
  const result = await backupMod.shareBackupFile(
    leads,
    tplMod.getTemplates('all'),
    tplMod.getCampaigns()
  );
  if (result && result.cancelled) {
    return;
  }
  resetAutoBackupCounter();
  if (result && result.shared) {
    showModalFeedback(feedbackEl, 'Respaldo compartido correctamente.');
  } else {
    showModalFeedback(feedbackEl, 'Respaldo descargado: ' + result.fileName);
  }
}

export async function importBackupJson(file, feedbackEl, onComplete) {
  if (!file) {
    return;
  }
  try {
    const backupMod = await import('../services/backup-service.js');
    const tplMod = await import('../services/template-service.js');
    const data = await backupMod.readBackupFile(file);
    const mergeStats = await mergeImportedLeads(data.leads);

    if (data.templates.length > 0) {
      const activeTemplates = tplMod.getAllTemplatesRaw();
      const existingIds = activeTemplates.map((t) => t.id);
      const mergedTemplates = activeTemplates.slice();
      data.templates.forEach((tpl) => {
        if (tpl && tpl.id && existingIds.indexOf(tpl.id) === -1) {
          mergedTemplates.push(tpl);
        }
      });
      if (mergedTemplates.length > activeTemplates.length) {
        tplMod.saveTemplates(mergedTemplates);
      }
    }

    if (onComplete) {
      await onComplete();
    }
    const msg = 'Fusión completada: ' + mergeStats.added + ' nuevos y ' + mergeStats.updated + ' actualizados.';
    showModalFeedback(feedbackEl, msg);
  } catch (error) {
    showModalFeedback(feedbackEl, error.message);
  }
}

export async function importBulkLeads(textareaEl, rubroSelectEl, feedbackEl, onComplete) {
  const backupMod = await import('../services/backup-service.js');
  const defaultRubro = rubroSelectEl ? rubroSelectEl.value : '';
  const parsedList = backupMod.parseBulkLeadsText(textareaEl.value, defaultRubro);
  if (parsedList.length === 0) {
    showModalFeedback(feedbackEl, 'No se detectaron contactos válidos. Usa: Nombre - Número');
    return;
  }
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < parsedList.length; i += 1) {
    const res = await saveLead(parsedList[i], { skipDuplicate: true });
    if (res && res.skipped) {
      skipped += 1;
    } else {
      added += 1;
    }
  }
  textareaEl.value = '';
  if (onComplete) {
    await onComplete();
  }
  const extra = skipped > 0 ? ' (' + skipped + ' duplicados omitidos).' : '.';
  showModalFeedback(feedbackEl, 'Se agregaron ' + added + ' prospectos nuevos' + extra);
}
