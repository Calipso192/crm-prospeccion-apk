import {
  saveLead,
  deleteLead,
  updateLeadReminder,
  updateLeadCampaignStage,
  applyLeadWhatsAppOutcome
} from '../services/db-service.js';
import { formatReminderLabel } from '../services/reminder-service.js';
import { getActiveCampaign, getActiveCampaignId } from '../services/template-service.js';
import { incrementWaLineUsage, getWaLineLabel } from '../services/channel-service.js';

const $ = (id) => document.getElementById(id);
const PENDING_WA_KEY = 'crm_prospeccion_pending_wa_v2';

export function createFormModalsController(dom, state, scheduler, campaignCtrl, selectionCtrl, callbacks) {
  let pendingConfirmHandler = null;

  function showFeedback(el, text) {
    if (!el) {
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function isCampaignClosed() {
    const camp = getActiveCampaign();
    return Boolean(camp && camp.status === 'cerrada');
  }

  function syncFormFields() {
    dom.saleAmountGroup.classList.toggle('hidden', dom.leadStatus.value !== 'vendido');
  }

  function formatReminderPreview(reminderAt, reminderReason) {
    const formatted = formatReminderLabel(reminderAt, reminderReason);
    return formatted ? formatted : 'Sin recordatorio';
  }

  function openConfirmModal(title, message, confirmLabel, onConfirm) {
    pendingConfirmHandler = typeof onConfirm === 'function' ? onConfirm : null;
    dom.modalTitle.textContent = title ? title : 'Confirmación';
    dom.modalMessage.textContent = message ? message : '';
    const confirmBtn = $('modal-btn-confirm');
    if (confirmBtn) {
      confirmBtn.textContent = confirmLabel ? confirmLabel : 'Confirmar';
    }
    dom.modal.classList.remove('hidden');
  }

  function openReminderModalForLead(lead) {
    state.reminderTargetLead = lead;
    let info = '';
    if (lead && lead.phone) { info = ' (+' + lead.phone + ')'; }
    else if (lead && lead.instagram) { info = ' (@' + lead.instagram + ')'; }
    dom.reminderLeadLabel.textContent = lead ? lead.name + info : 'Nuevo prospecto';
    scheduler.loadFromLead(lead ? lead : state.draftReminder);
    dom.reminderModal.classList.remove('hidden');
  }

  function openForm(lead) {
    dom.formFeedback.classList.add('hidden');
    dom.formTitle.textContent = lead ? 'Editar Prospecto' : 'Registrar Prospecto';
    if (lead) {
      dom.leadId.value = lead.id;
      dom.leadName.value = lead.name;
      dom.leadPhone.value = lead.phone ? lead.phone : '';
      if (dom.leadInstagram) {
        dom.leadInstagram.value = lead.instagram ? '@' + lead.instagram : '';
      }
      dom.leadRubro.value = lead.rubro ? lead.rubro : '';
      dom.leadStatus.value = lead.stage ? lead.stage : (lead.status ? lead.status : 'nuevo');
      dom.leadAmount.value = lead.saleAmount > 0 ? String(lead.saleAmount) : '';
      dom.leadNotes.value = lead.baseNotes ? lead.baseNotes : (lead.notes ? lead.notes : '');
      state.draftReminder = { reminderAt: lead.reminderAt, reminderReason: lead.reminderReason };
    } else {
      dom.leadForm.reset();
      dom.leadId.value = '';
      dom.leadRubro.value = '';
      state.draftReminder = { reminderAt: '', reminderReason: '' };
    }
    dom.formReminderPreview.textContent = formatReminderPreview(
      state.draftReminder.reminderAt,
      state.draftReminder.reminderReason
    );
    syncFormFields();
    dom.formModal.classList.remove('hidden');
    dom.leadName.focus();
  }

  function closeForm() {
    dom.formFeedback.classList.add('hidden');
    dom.leadForm.reset();
    dom.leadId.value = '';
    dom.formModal.classList.add('hidden');
  }

  function openDeleteModal(lead) {
    openConfirmModal(
      'Eliminar Prospecto',
      '¿Seguro que deseas eliminar a ' + lead.name + '? Se borrará su ficha maestra de todas las campañas.',
      'Eliminar',
      async () => {
        await deleteLead(lead.id);
        await callbacks.onCancelNativeReminder(lead.id);
        await callbacks.onRefreshLeads();
      }
    );
  }

  function openQuickStatusModal(lead) {
    selectionCtrl.clearBulkStatusFlag();
    state.quickStatusLead = lead;
    dom.quickStatusTitle.textContent = 'Mover prospecto';
    let contactPart = '';
    if (lead.phone) { contactPart = ' (+' + lead.phone + ')'; }
    else if (lead.instagram) { contactPart = ' (@' + lead.instagram + ')'; }
    dom.quickStatusLeadName.textContent = lead.name + contactPart;
    dom.quickSaleBox.classList.add('hidden');
    dom.quickSaleAmount.value = lead.saleAmount > 0 ? String(lead.saleAmount) : '';
    dom.quickStatusModal.classList.remove('hidden');
  }

  function openBulkStatusModal(count) {
    state.quickStatusLead = null;
    dom.quickStatusTitle.textContent = 'Mover seleccionados';
    dom.quickStatusLeadName.textContent = count === 1 ? '1 prospecto seleccionado' : count + ' prospectos seleccionados';
    dom.quickSaleBox.classList.add('hidden');
    dom.quickSaleAmount.value = '';
    dom.quickStatusModal.classList.remove('hidden');
  }

  async function handleQuickStatusConfirm(targetStatus, amountValue) {
    dom.quickStatusModal.classList.add('hidden');
    if (selectionCtrl.isBulkStatusActive()) {
      await selectionCtrl.applyBulkStatus(targetStatus, amountValue);
      return;
    }
    const lead = state.quickStatusLead;
    state.quickStatusLead = null;
    if (!lead) {
      return;
    }
    const campId = lead.campaignId ? lead.campaignId : getActiveCampaignId();
    await updateLeadCampaignStage(lead.id, campId, targetStatus, {
      saleAmount: targetStatus === 'vendido' ? amountValue : 0
    });
    await callbacks.onRefreshLeads();
  }

  async function applyWhatsAppOutcome(action) {
    const pending = state.pendingWhatsAppLead;
    state.pendingWhatsAppLead = null;
    try {
      sessionStorage.removeItem(PENDING_WA_KEY);
    } catch (error) {
      /* Sin sessionStorage disponible */
    }
    dom.statusModal.classList.add('hidden');
    if (!pending) {
      return;
    }
    const targetId = pending.leadId ? pending.leadId : pending.id;
    if (!(targetId && action)) {
      return;
    }
    const campId = pending.campaignId ? pending.campaignId : getActiveCampaignId();
    const isSentAction = action === 'contactado' ? true : action === 'keep_sent';
    const tpl = isSentAction && pending.tpl ? pending.tpl : null;
    const lineId = isSentAction ? pending.waLineUsed : '';
    await applyLeadWhatsAppOutcome(targetId, campId, action, tpl, lineId);
    if (isSentAction) {
      const nextCount = incrementWaLineUsage(lineId);
      if (callbacks.onShowToast) {
        callbacks.onShowToast('WhatsApp enviado (' + getWaLineLabel(lineId) + ' · ' + nextCount + '/300)', false);
      }
    }
    await callbacks.onRefreshLeads();
  }

  function getTemplateEditorHooks() {
    return {
      onOpenBulkTag: (tpl) => campaignCtrl.openBulkTagModal(tpl),
      onTemplatesChanged: async () => {
        await campaignCtrl.refreshFilterDropdown();
        await callbacks.onRefreshLeads();
      }
    };
  }

  async function handleInterestCatalogChanged() {
    await campaignCtrl.refreshFilterDropdown();
    await callbacks.onRefreshLeads();
  }

  async function openInterestManagerModal() {
    if (!dom.interestManagerModal) {
      return;
    }
    if (dom.interestManagerFeedback) {
      dom.interestManagerFeedback.classList.add('hidden');
    }
    const intUi = await import('./interest-manager-ui.js');
    intUi.renderInterestTagsEditor(dom.interestTagsEditorList, handleInterestCatalogChanged);
    dom.interestManagerModal.classList.remove('hidden');
  }

  function bindInterestManager() {
    const btnClose = $('btn-close-interest-manager');
    if (btnClose && dom.interestManagerModal) {
      btnClose.addEventListener('click', () => dom.interestManagerModal.classList.add('hidden'));
    }
    if (dom.newInterestTagForm) {
      dom.newInterestTagForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          const intUi = await import('./interest-manager-ui.js');
          await intUi.createNewInterestTag(
            dom.newIntLabel.value,
            dom.newIntTone.value,
            dom.interestTagsEditorList,
            handleInterestCatalogChanged
          );
          dom.newInterestTagForm.reset();
          if (dom.interestManagerFeedback) {
            dom.interestManagerFeedback.classList.add('hidden');
          }
        } catch (error) {
          showFeedback(dom.interestManagerFeedback, error.message);
        }
      });
    }
  }

  function getExportList() {
    return Array.isArray(state.masterLeads) ? state.masterLeads : state.leads;
  }

  function bindBackupAndTemplates() {
    $('btn-backup').addEventListener('click', () => {
      dom.backupFeedback.classList.add('hidden');
      dom.backupModal.classList.remove('hidden');
    });
    $('btn-close-backup').addEventListener('click', () => dom.backupModal.classList.add('hidden'));
    $('btn-export-backup').addEventListener('click', async () => {
      const tools = await import('./modal-tools.js');
      await tools.exportBackupJson(getExportList(), dom.backupFeedback);
      await callbacks.onRenderActiveView();
    });
    $('btn-share-backup').addEventListener('click', async () => {
      const tools = await import('./modal-tools.js');
      await tools.shareBackupJson(getExportList(), dom.backupFeedback);
      await callbacks.onRenderActiveView();
    });
    $('btn-copy-backup').addEventListener('click', async () => {
      const tools = await import('./modal-tools.js');
      await tools.copyBackupJson(getExportList(), dom.backupFeedback);
      await callbacks.onRenderActiveView();
    });
    $('input-import-backup').addEventListener('change', async (ev) => {
      const tools = await import('./modal-tools.js');
      await tools.importBackupJson(ev.target.files ? ev.target.files[0] : null, dom.backupFeedback, async () => {
        await callbacks.onSyncTagLabels();
        await campaignCtrl.refreshFilterDropdown();
        await callbacks.onRefreshLeads();
      });
      ev.target.value = '';
    });
    $('btn-import-bulk').addEventListener('click', async () => {
      if (isCampaignClosed()) {
        showFeedback(dom.backupFeedback, 'La campaña activa está cerrada. Reábrela o cambia a una campaña activa para importar contactos.');
        return;
      }
      const tools = await import('./modal-tools.js');
      await tools.importBulkLeads(dom.bulkLeadsText, dom.bulkDefaultRubro, dom.backupFeedback, callbacks.onRefreshLeads);
    });
    $('btn-manage-templates').addEventListener('click', async () => {
      const tools = await import('./modal-tools.js');
      await tools.renderTemplatesEditor(dom.templatesEditorList, getTemplateEditorHooks());
      dom.managerModal.classList.remove('hidden');
    });
    $('btn-close-manager').addEventListener('click', () => dom.managerModal.classList.add('hidden'));
    dom.newTemplateForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const tools = await import('./modal-tools.js');
      await tools.createNewTemplate(dom.newTplLabel.value, dom.newTplText.value, {
        phase: Number(dom.newTplPhase.value),
        rubro: dom.newTplRubro.value
      }, dom.templatesEditorList, getTemplateEditorHooks());
      dom.newTemplateForm.reset();
    });
  }

  function bind() {
    bindBackupAndTemplates();
    bindInterestManager();
    $('btn-new-lead').addEventListener('click', () => openForm(null));
    $('btn-cancel-form').addEventListener('click', closeForm);
    dom.leadStatus.addEventListener('change', syncFormFields);
    $('btn-form-open-reminder').addEventListener('click', () => openReminderModalForLead(null));
    $('btn-close-reminder').addEventListener('click', () => {
      state.reminderTargetLead = null;
      dom.reminderModal.classList.add('hidden');
    });
    $('btn-save-reminder').addEventListener('click', async () => {
      const vals = scheduler.getValues();
      const target = state.reminderTargetLead;
      dom.reminderModal.classList.add('hidden');
      if (target) {
        const campId = target.campaignId ? target.campaignId : getActiveCampaignId();
        const updatedMaster = await updateLeadReminder(target.id, campId, vals.reminderAt, vals.reminderReason);
        if (updatedMaster) {
          if (vals.reminderAt) {
            await callbacks.onScheduleNativeReminder({
              id: updatedMaster.id,
              name: updatedMaster.name,
              phone: updatedMaster.phone,
              instagram: updatedMaster.instagram,
              reminderAt: vals.reminderAt,
              reminderReason: vals.reminderReason
            });
          } else {
            await callbacks.onCancelNativeReminder(updatedMaster.id);
          }
        }
        state.reminderTargetLead = null;
        await callbacks.onRefreshLeads();
        return;
      }
      state.draftReminder = vals;
      dom.formReminderPreview.textContent = formatReminderPreview(vals.reminderAt, vals.reminderReason);
    });
    dom.leadForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (isCampaignClosed()) {
        showFeedback(dom.formFeedback, 'Esta campaña está cerrada. Reábrela desde el Dashboard para guardar cambios.');
        return;
      }
      const existingId = dom.leadId.value;
      const existingLead = existingId ? state.leads.find((item) => item.id === existingId) : null;
      const hadReminder = Boolean(existingLead && existingLead.reminderAt);
      const activeCid = getActiveCampaignId();
      try {
        const saved = await saveLead({
          id: existingId ? existingId : null,
          name: dom.leadName.value,
          phone: dom.leadPhone.value,
          instagram: dom.leadInstagram ? dom.leadInstagram.value : '',
          rubro: dom.leadRubro.value,
          stage: dom.leadStatus.value,
          saleAmount: dom.leadAmount.value,
          reminderAt: state.draftReminder.reminderAt,
          reminderReason: state.draftReminder.reminderReason,
          baseNotes: dom.leadNotes.value,
          campaignId: existingLead && existingLead.campaignId ? existingLead.campaignId : activeCid
        });
        if (saved && state.draftReminder.reminderAt) {
          await callbacks.onScheduleNativeReminder({
            id: saved.id,
            name: saved.name,
            phone: saved.phone,
            instagram: saved.instagram,
            reminderAt: state.draftReminder.reminderAt,
            reminderReason: state.draftReminder.reminderReason
          });
        } else if (saved && hadReminder) {
          await callbacks.onCancelNativeReminder(saved.id);
        }
        closeForm();
        await callbacks.onRefreshLeads();
      } catch (error) {
        showFeedback(dom.formFeedback, error.message);
      }
    });
    $('note-shortcuts').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-note]');
      if (!btn) { return; }
      const snippet = btn.dataset.note;
      const current = dom.leadNotes.value.trim();
      if (current.indexOf(snippet) === -1) {
        dom.leadNotes.value = current ? current + ' · ' + snippet : snippet;
      }
      dom.leadNotes.focus();
    });
    $('quick-status-options').addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-target-status]');
      if (!btn) { return; }
      if (btn.dataset.targetStatus === 'vendido') {
        dom.quickSaleBox.classList.remove('hidden');
        dom.quickSaleAmount.focus();
        return;
      }
      await handleQuickStatusConfirm(btn.dataset.targetStatus, 0);
    });
    $('btn-confirm-quick-sale').addEventListener('click', () => handleQuickStatusConfirm('vendido', dom.quickSaleAmount.value));
    $('btn-close-quick-status').addEventListener('click', () => {
      state.quickStatusLead = null;
      selectionCtrl.clearBulkStatusFlag();
      dom.quickStatusModal.classList.add('hidden');
    });
    $('modal-btn-cancel').addEventListener('click', () => {
      pendingConfirmHandler = null;
      dom.modal.classList.add('hidden');
    });
    $('modal-btn-confirm').addEventListener('click', async () => {
      const handler = pendingConfirmHandler;
      pendingConfirmHandler = null;
      dom.modal.classList.add('hidden');
      if (handler) {
        await handler();
      }
    });
    $('btn-status-contacted').addEventListener('click', () => {
      const curStage = state.pendingWhatsAppLead ? state.pendingWhatsAppLead.currentStage : 'nuevo';
      const action = ['nuevo', 'sin_whatsapp'].includes(curStage) ? 'contactado' : 'keep_sent';
      applyWhatsAppOutcome(action);
    });
    $('btn-status-no-wa').addEventListener('click', () => applyWhatsAppOutcome('sin_whatsapp'));
    $('btn-status-keep').addEventListener('click', () => applyWhatsAppOutcome(null));
  }

  return {
    bind,
    openConfirmModal,
    openReminderModalForLead,
    openForm,
    openDeleteModal,
    openQuickStatusModal,
    openBulkStatusModal,
    openInterestManagerModal
  };
}
