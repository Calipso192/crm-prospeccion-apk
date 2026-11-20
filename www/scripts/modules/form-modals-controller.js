import {
  saveLead,
  deleteLead,
  updateLeadReminder,
  applyLeadWhatsAppOutcome
} from '../services/db-service.js';
import { formatReminderLabel } from '../services/reminder-service.js';
import { getActiveCampaignId } from '../services/template-service.js';

const $ = (id) => document.getElementById(id);
const PENDING_WA_KEY = 'crm_prospeccion_pending_wa_v2';

export function createFormModalsController(dom, state, scheduler, campaignCtrl, selectionCtrl, callbacks) {
  function showFeedback(el, text) {
    if (!el) {
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function syncFormFields() {
    dom.saleAmountGroup.classList.toggle('hidden', dom.leadStatus.value !== 'vendido');
  }

  function formatReminderPreview(reminderAt, reminderReason) {
    const formatted = formatReminderLabel(reminderAt, reminderReason);
    return formatted ? formatted : 'Sin recordatorio';
  }

  function openReminderModalForLead(lead) {
    state.reminderTargetLead = lead;
    dom.reminderLeadLabel.textContent = lead ? lead.name + ' (+' + lead.phone + ')' : 'Nuevo prospecto';
    scheduler.loadFromLead(lead ? lead : state.draftReminder);
    dom.reminderModal.classList.remove('hidden');
  }

  function openForm(lead) {
    dom.formFeedback.classList.add('hidden');
    dom.formTitle.textContent = lead ? 'Editar Prospecto' : 'Registrar Prospecto';
    if (lead) {
      dom.leadId.value = lead.id;
      dom.leadName.value = lead.name;
      dom.leadPhone.value = lead.phone;
      dom.leadRubro.value = lead.rubro ? lead.rubro : '';
      dom.leadStatus.value = lead.status;
      dom.leadAmount.value = lead.saleAmount > 0 ? String(lead.saleAmount) : '';
      dom.leadNotes.value = lead.notes ? lead.notes : '';
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
    state.pendingDeleteId = lead.id;
    dom.modalTitle.textContent = 'Eliminar Prospecto';
    dom.modalMessage.textContent = '¿Seguro que deseas eliminar a ' + lead.name + '? Esta acción no se puede deshacer.';
    dom.modal.classList.remove('hidden');
  }

  function openQuickStatusModal(lead) {
    selectionCtrl.clearBulkStatusFlag();
    state.quickStatusLead = lead;
    dom.quickStatusTitle.textContent = 'Mover prospecto';
    dom.quickStatusLeadName.textContent = lead.name + ' (+' + lead.phone + ')';
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
    await saveLead(Object.assign({}, lead, {
      status: targetStatus,
      saleAmount: targetStatus === 'vendido' ? amountValue : 0
    }));
    await callbacks.onRefreshLeads();
  }

  async function applyWhatsAppOutcome(newStatus) {
    const pending = state.pendingWhatsAppLead;
    state.pendingWhatsAppLead = null;
    try {
      sessionStorage.removeItem(PENDING_WA_KEY);
    } catch (error) {}
    dom.statusModal.classList.add('hidden');
    const targetId = pending ? (pending.leadId || pending.id) : '';
    if (targetId && newStatus) {
      const tpl = newStatus === 'contactado' && pending.tpl ? pending.tpl : null;
      await applyLeadWhatsAppOutcome(targetId, newStatus, tpl);
      await callbacks.onRefreshLeads();
    }
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

  function bindBackupAndTemplates() {
    $('btn-backup').addEventListener('click', () => {
      dom.backupFeedback.classList.add('hidden');
      dom.backupModal.classList.remove('hidden');
    });
    $('btn-close-backup').addEventListener('click', () => dom.backupModal.classList.add('hidden'));
    $('btn-export-backup').addEventListener('click', async () => {
      const tools = await import('./modal-tools.js');
      await tools.exportBackupJson(state.leads, dom.backupFeedback);
      await callbacks.onRenderActiveView();
    });
    $('btn-share-backup').addEventListener('click', async () => {
      const tools = await import('./modal-tools.js');
      await tools.shareBackupJson(state.leads, dom.backupFeedback);
      await callbacks.onRenderActiveView();
    });
    $('btn-copy-backup').addEventListener('click', async () => {
      const tools = await import('./modal-tools.js');
      await tools.copyBackupJson(state.leads, dom.backupFeedback);
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
        const updated = await updateLeadReminder(target.id, vals.reminderAt, vals.reminderReason);
        if (updated) {
          if (vals.reminderAt) {
            await callbacks.onScheduleNativeReminder(updated);
          } else {
            await callbacks.onCancelNativeReminder(updated.id);
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
      const existingId = dom.leadId.value;
      const existingLead = existingId ? state.leads.find((item) => item.id === existingId) : null;
      const hadReminder = Boolean(existingLead && existingLead.reminderAt);
      try {
        const saved = await saveLead(Object.assign({}, existingLead ? existingLead : {}, {
          id: existingId ? existingId : null,
          name: dom.leadName.value,
          phone: dom.leadPhone.value,
          rubro: dom.leadRubro.value,
          status: dom.leadStatus.value,
          saleAmount: dom.leadAmount.value,
          reminderAt: state.draftReminder.reminderAt,
          reminderReason: state.draftReminder.reminderReason,
          notes: dom.leadNotes.value,
          campaignId: existingLead && existingLead.campaignId ? existingLead.campaignId : getActiveCampaignId()
        }));
        if (saved && saved.reminderAt) {
          await callbacks.onScheduleNativeReminder(saved);
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
      state.pendingDeleteId = null;
      dom.modal.classList.add('hidden');
    });
    $('modal-btn-confirm').addEventListener('click', async () => {
      if (state.pendingDeleteId) {
        const idToDel = state.pendingDeleteId;
        state.pendingDeleteId = null;
        dom.modal.classList.add('hidden');
        await deleteLead(idToDel);
        await callbacks.onCancelNativeReminder(idToDel);
        await callbacks.onRefreshLeads();
      }
    });
    $('btn-status-contacted').addEventListener('click', () => applyWhatsAppOutcome('contactado'));
    $('btn-status-no-wa').addEventListener('click', () => applyWhatsAppOutcome('sin_whatsapp'));
    $('btn-status-keep').addEventListener('click', () => applyWhatsAppOutcome(null));
  }

  return {
    bind,
    openReminderModalForLead,
    openForm,
    openDeleteModal,
    openQuickStatusModal,
    openBulkStatusModal,
    openInterestManagerModal
  };
}
