import {
  getAllLeads, saveLead, addTagToLead, toggleInterestTag,
  addQuickNoteToLead, removeQuickNoteFromLead, syncAllTagLabels,
  getAutoBackupMeta, normalizePhone
} from './services/db-service.js';
import { evaluateLeadPhase, getInterestTagsCatalog } from './services/phase-engine.js';
import { scheduleNativeReminder, cancelNativeReminder } from './services/reminder-service.js';
import { renderDashboardView } from './modules/dashboard-view.js';
import { createCalendarScheduler } from './modules/calendar-scheduler.js';
import { createCampaignController } from './modules/campaign-controller.js';
import { createSelectionController } from './modules/selection-controller.js';
import { createListRenderer } from './modules/list-renderer.js';
import { createFormModalsController } from './modules/form-modals-controller.js';

const $ = (id) => document.getElementById(id);
const PENDING_WA_KEY = 'crm_prospeccion_pending_wa_v2';

const state = {
  leads: [], activeView: 'dashboard', filter: 'todos', queueFilter: '',
  rubro: 'todos', interestFilter: 'todas', campaignTplId: 'todas', campaignState: 'pendiente',
  searchQuery: '', pendingDeleteId: null, pendingWhatsAppLead: null,
  activePickerLead: null, quickStatusLead: null, reminderTargetLead: null,
  draftReminder: { reminderAt: '', reminderReason: '' },
  selectionMode: false, selectedIds: []
};

const dom = {
  leadCounter: $('lead-counter'), revenueCounter: $('revenue-counter'),
  tabDashboard: $('tab-dashboard'), tabLeads: $('tab-leads'),
  dashboardView: $('dashboard-view'), leadsView: $('leads-view'),
  queueFilterBanner: $('queue-filter-banner'), queueFilterText: $('queue-filter-text'),
  searchInput: $('search-input'), btnClearSearch: $('btn-clear-search'),
  formModal: $('lead-form-modal'), formTitle: $('form-title'),
  formFeedback: $('form-feedback'), leadForm: $('lead-form'), leadId: $('lead-id'),
  leadName: $('lead-name'), leadPhone: $('lead-phone'), leadRubro: $('lead-rubro'),
  leadStatus: $('lead-status'), saleAmountGroup: $('sale-amount-group'),
  leadAmount: $('lead-amount'), leadNotes: $('lead-notes'),
  formReminderPreview: $('form-reminder-preview'), reminderModal: $('reminder-modal'),
  reminderLeadLabel: $('reminder-lead-label'), leadsList: $('leads-list'),
  quickStatusModal: $('quick-status-modal'), quickStatusTitle: $('quick-status-title'),
  quickStatusLeadName: $('quick-status-lead-name'), quickSaleBox: $('quick-sale-box'),
  quickSaleAmount: $('quick-sale-amount'), modal: $('custom-modal'),
  modalTitle: $('modal-title'), modalMessage: $('modal-message'),
  statusModal: $('status-modal'), statusModalMessage: $('status-modal-message'),
  pickerModal: $('template-picker-modal'), pickerLeadName: $('picker-lead-name'),
  pickerButtonsList: $('picker-buttons-list'), managerModal: $('template-manager-modal'),
  templatesEditorList: $('templates-editor-list'), newTemplateForm: $('new-template-form'),
  newTplLabel: $('new-tpl-label'), newTplPhase: $('new-tpl-phase'),
  newTplRubro: $('new-tpl-rubro'), newTplText: $('new-tpl-text'),
  interestManagerModal: $('interest-manager-modal'), interestManagerFeedback: $('interest-manager-feedback'),
  interestTagsEditorList: $('interest-tags-editor-list'), newInterestTagForm: $('new-interest-tag-form'),
  newIntLabel: $('new-int-label'), newIntTone: $('new-int-tone'),
  backupModal: $('backup-modal'), backupFeedback: $('backup-feedback'),
  bulkLeadsText: $('bulk-leads-text'), bulkDefaultRubro: $('bulk-default-rubro')
};

const scheduler = createCalendarScheduler({
  quickHoursChips: $('cal-quick-hours'), dayChips: $('cal-day-chips'),
  customDate: $('cal-custom-date'), hourChips: $('cal-hour-chips'),
  minuteChips: $('cal-minute-chips'), reasonChips: $('cal-reason-chips'),
  reasonInput: $('cal-reason-input'), preview: $('cal-selected-preview'),
  btnClear: $('btn-clear-calendar'), btnOpenCalendar: $('btn-form-calendar')
}, () => {
  const target = state.reminderTargetLead;
  if (target) {
    return { name: target.name, phone: target.phone, notes: target.notes };
  }
  return { name: dom.leadName.value, phone: normalizePhone(dom.leadPhone.value), notes: dom.leadNotes.value };
});

const campaignCtrl = createCampaignController({
  rubroFilter: $('rubro-filter'), interestFilter: $('interest-filter'),
  campaignTplFilter: $('campaign-tpl-filter'),
  campaignStatusRow: $('campaign-status-row'), tagPickerModal: $('tag-picker-modal'),
  tagPickerTitle: $('tag-picker-title'), tagPickerLeadName: $('tag-picker-lead-name'),
  tagRetroactiveRow: $('tag-retroactive-row'), tagPickerList: $('tag-picker-list'),
  btnTagPickerCancel: $('btn-tag-picker-cancel'), bulkTagModal: $('bulk-tag-modal'),
  bulkTagTplName: $('bulk-tag-tpl-name'), bulkTagFeedback: $('bulk-tag-feedback'),
  bulkTagRetroSelect: $('bulk-tag-retro-select'), bulkStatusChecks: $('bulk-status-checks'),
  btnCancelBulkTag: $('btn-cancel-bulk-tag'), btnConfirmBulkTag: $('btn-confirm-bulk-tag'),
  newCampaignModal: $('new-campaign-modal'), newCampaignForm: $('new-campaign-form'),
  newCampaignName: $('new-campaign-name'), newCampaignDesc: $('new-campaign-desc'),
  newCampaignClone: $('new-campaign-clone'), newCampaignFeedback: $('new-campaign-feedback'),
  btnCancelNewCampaign: $('btn-cancel-new-campaign'),
  btnSubmitNewCampaign: $('btn-submit-new-campaign')
}, state, {
  onFilterChange: () => renderActiveView(),
  onDataChanged: () => refreshLeads(),
  getLeadCount: () => state.leads.length,
  onCancelNativeReminder: (id) => cancelNativeReminder(id)
});

const selectionCtrl = createSelectionController({
  bulkSelectionBar: $('bulk-selection-bar'), bulkSelCount: $('bulk-sel-count'),
  btnBulkSelAll: $('btn-bulk-sel-all'), btnBulkSelCancel: $('btn-bulk-sel-cancel'),
  btnBulkSelTag: $('btn-bulk-sel-tag'), btnBulkSelRubro: $('btn-bulk-sel-rubro'),
  btnBulkSelStatus: $('btn-bulk-sel-status'), rubroPickerModal: $('rubro-picker-modal'),
  rubroPickerTitle: $('rubro-picker-title'), rubroPickerSubtitle: $('rubro-picker-subtitle'),
  rubroPickerOptions: $('rubro-picker-options'), btnRubroPickerCancel: $('btn-rubro-picker-cancel')
}, state, {
  onRender: () => listRenderer.render(state.leads),
  onSyncSelectionUi: () => listRenderer.syncSelectionUi(),
  onDataChanged: () => refreshLeads(),
  getVisibleLeadIds: () => listRenderer.getVisibleIds(),
  onOpenBulkTagPicker: (ids) => campaignCtrl.openBulkSelectedTagModal(ids, () => selectionCtrl.exitSelection()),
  onOpenBulkStatusModal: (count) => modalsCtrl.openBulkStatusModal(count)
});

const listRenderer = createListRenderer({ leadsList: dom.leadsList }, state, (waMod, tagLabelsMap) => ({
  tagLabelsMap: tagLabelsMap,
  onEnterSelection: (lead) => selectionCtrl.enterSelection(lead),
  onToggleSelect: (lead) => selectionCtrl.toggleSelect(lead),
  onPickRubro: (lead) => selectionCtrl.openSingleRubroPicker(lead),
  onQuickStatus: (lead) => modalsCtrl.openQuickStatusModal(lead),
  onWhatsApp: (lead) => openTemplatePicker(lead),
  onCall: (lead) => waMod.openPhoneCall(lead),
  onSearch: (lead) => waMod.searchProspectOnline(lead),
  onOpenReminderModal: (lead) => modalsCtrl.openReminderModalForLead(lead),
  onQuickDiscard: async (lead) => {
    await saveLead(Object.assign({}, lead, { status: 'descartado', saleAmount: 0 }));
    await refreshLeads();
  },
  onToggleInterestTag: async (lead, tagObj) => {
    await toggleInterestTag(lead.id, tagObj);
    await refreshLeads();
  },
  onAddQuickNote: async (lead, noteText) => {
    await addQuickNoteToLead(lead.id, noteText);
    await refreshLeads();
  },
  onRemoveQuickNote: async (lead, noteId) => {
    await removeQuickNoteFromLead(lead.id, noteId);
    await refreshLeads();
  },
  onRemoveTag: (lead, tag) => campaignCtrl.removeTag(lead, tag),
  onOpenAddTag: (lead) => campaignCtrl.openManualTagModal(lead),
  onEdit: (lead) => modalsCtrl.openForm(lead),
  onDelete: (lead) => modalsCtrl.openDeleteModal(lead)
}));

const modalsCtrl = createFormModalsController(dom, state, scheduler, campaignCtrl, selectionCtrl, {
  onRefreshLeads: () => refreshLeads(),
  onRenderActiveView: () => renderActiveView(),
  onSyncTagLabels: () => syncStoredTagLabels(),
  onScheduleNativeReminder: (lead) => scheduleNativeReminder(lead),
  onCancelNativeReminder: (id) => cancelNativeReminder(id)
});

const QUEUE_NAMES = {
  seg_urgente: 'Seguimientos vencidos y de hoy',
  nuevo_f1: 'Nuevos sin Fase 1',
  listo_f2: 'Listos para Fase 2 (+3 días)',
  listo_f3: 'Listos para Fase 3 (+4 días)',
  listo_descartar: 'Listos para Descartar (+24h)'
};

function syncFilterChipsUi() {
  document.querySelectorAll('.filter-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === state.filter);
  });
  if (state.queueFilter) {
    let label = QUEUE_NAMES[state.queueFilter] ? QUEUE_NAMES[state.queueFilter] : '';
    if (!label && state.queueFilter.startsWith('int_')) {
      const foundTag = getInterestTagsCatalog().find((t) => t.id === state.queueFilter);
      label = foundTag ? foundTag.label : 'Etiqueta de interés activa';
    }
    dom.queueFilterText.textContent = 'Cola activa: ' + (label || 'Filtro activo');
    dom.queueFilterBanner.classList.remove('hidden');
  } else {
    dom.queueFilterBanner.classList.add('hidden');
  }
}

async function switchView(targetView) {
  state.activeView = targetView === 'leads' ? 'leads' : 'dashboard';
  const isDash = state.activeView === 'dashboard';
  dom.tabDashboard.classList.toggle('active', isDash);
  dom.tabLeads.classList.toggle('active', !isDash);
  dom.dashboardView.classList.toggle('hidden', !isDash);
  dom.leadsView.classList.toggle('hidden', isDash);
  if (!isDash && state.selectionMode) {
    selectionCtrl.exitSelection();
  }
  await renderActiveView();
}

function updateTopBadges() {
  const totalCount = state.leads.length;
  dom.leadCounter.textContent = totalCount === 1 ? '1 prospecto' : totalCount + ' prospectos';
  let revenue = 0;
  state.leads.forEach((item) => {
    if (item.status === 'vendido' && Number(item.saleAmount) > 0) {
      revenue += Number(item.saleAmount);
    }
  });
  dom.revenueCounter.textContent = 'S/ ' + revenue.toFixed(2);
}

async function renderActiveView() {
  updateTopBadges();
  syncFilterChipsUi();
  if (state.activeView === 'dashboard') {
    const tplMod = await import('./services/template-service.js');
    const campState = {
      campaigns: tplMod.getCampaigns(),
      activeCampaignId: tplMod.getActiveCampaignId()
    };
    renderDashboardView(dom.dashboardView, state.leads, campState, getAutoBackupMeta(), {
      onSelectQueueFilter: async (queueKey, statusKey) => {
        state.filter = statusKey ? statusKey : 'todos';
        state.queueFilter = queueKey;
        await switchView('leads');
      },
      onSelectStageFilter: async (statusKey) => {
        state.filter = statusKey ? statusKey : 'todos';
        state.queueFilter = '';
        await switchView('leads');
      },
      onOpenNewCampaign: () => campaignCtrl.openNewCampaignModal(),
      onSwitchCampaign: async (campId) => campaignCtrl.switchCampaign(campId),
      onOpenInterestManager: () => modalsCtrl.openInterestManagerModal(),
      onQuickExportBackup: async () => {
        const tools = await import('./modules/modal-tools.js');
        await tools.exportBackupJson(state.leads, null);
        await renderActiveView();
      },
      onOpenBulkPaste: () => {
        dom.backupFeedback.classList.add('hidden');
        dom.backupModal.classList.remove('hidden');
        dom.bulkLeadsText.focus();
      }
    });
    return;
  }
  await listRenderer.render(state.leads);
}

async function refreshLeads() {
  state.leads = await getAllLeads();
  await renderActiveView();
}

function showPendingWhatsAppPrompt() {
  if (!state.pendingWhatsAppLead) {
    return;
  }
  const name = state.pendingWhatsAppLead.leadName || 'este contacto';
  dom.statusModalMessage.textContent = '¿Cómo te fue al contactar a ' + name + ' por WhatsApp?';
  dom.statusModal.classList.remove('hidden');
}

async function launchWhatsAppWithText(lead, customText, tpl) {
  state.activePickerLead = null;
  dom.pickerModal.classList.add('hidden');
  const waModule = await import('./services/whatsapp-service.js');
  if (!waModule.openWhatsAppChat(lead, customText)) {
    return;
  }
  if (lead.status === 'nuevo') {
    const pending = {
      leadId: lead.id,
      leadName: lead.name,
      tpl: tpl && tpl.id ? { id: tpl.id, label: tpl.label, phase: Number(tpl.phase) || 0 } : null
    };
    state.pendingWhatsAppLead = pending;
    try {
      sessionStorage.setItem(PENDING_WA_KEY, JSON.stringify(pending));
    } catch (error) {
      return;
    }
    return;
  }
  if (tpl && tpl.id) {
    await addTagToLead(lead.id, {
      id: tpl.id,
      label: tpl.label,
      phase: Number(tpl.phase) || 0,
      sentAt: Date.now()
    });
    await refreshLeads();
  }
}

async function openTemplatePicker(lead) {
  state.activePickerLead = lead;
  const phaseInfo = evaluateLeadPhase(lead);
  const phaseSuffix = phaseInfo.suggestedPhase > 0 ? ' · Sugerido: Fase ' + phaseInfo.suggestedPhase : '';
  dom.pickerLeadName.textContent = lead.name + phaseSuffix;
  dom.pickerButtonsList.innerHTML = '';

  const tplModule = await import('./services/template-service.js');
  const templates = tplModule.getTemplates().slice().sort((a, b) => {
    const scoreA = (a.phase === phaseInfo.suggestedPhase ? 2 : 0) + (a.rubro && a.rubro === lead.rubro ? 1 : 0);
    const scoreB = (b.phase === phaseInfo.suggestedPhase ? 2 : 0) + (b.rubro && b.rubro === lead.rubro ? 1 : 0);
    return scoreB - scoreA;
  });

  const eligible = templates.filter((tpl) => !(tpl.rubro && lead.rubro && tpl.rubro !== lead.rubro));
  if (eligible.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'helper-hint';
    hint.textContent = 'No hay plantillas en esta campaña. Usa "Mensajes" para crear una o envía mensaje libre.';
    dom.pickerButtonsList.appendChild(hint);
  } else {
    eligible.forEach((tpl) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = tpl.phase === phaseInfo.suggestedPhase ? 'btn-whatsapp' : 'btn-secondary';
      btn.textContent = tpl.label;
      btn.addEventListener('click', () => launchWhatsAppWithText(lead, tplModule.renderTemplateText(tpl.text, lead), tpl));
      dom.pickerButtonsList.appendChild(btn);
    });
  }
  dom.pickerModal.classList.remove('hidden');
}

function bindEvents() {
  scheduler.bind();
  campaignCtrl.bind();
  selectionCtrl.bind();
  modalsCtrl.bind();

  dom.tabDashboard.addEventListener('click', () => switchView('dashboard'));
  dom.tabLeads.addEventListener('click', () => switchView('leads'));

  $('btn-clear-queue-filter').addEventListener('click', async () => {
    state.queueFilter = '';
    await renderActiveView();
  });

  let searchTimer = null;
  dom.searchInput.addEventListener('input', () => {
    state.searchQuery = dom.searchInput.value;
    dom.btnClearSearch.classList.toggle('hidden', state.searchQuery.length === 0);
    if (searchTimer) {
      clearTimeout(searchTimer);
    }
    searchTimer = setTimeout(async () => {
      if (state.searchQuery.trim().length > 0 && state.activeView === 'dashboard') {
        await switchView('leads');
        return;
      }
      await renderActiveView();
    }, 180);
  });

  dom.btnClearSearch.addEventListener('click', async () => {
    dom.searchInput.value = '';
    state.searchQuery = '';
    dom.btnClearSearch.classList.add('hidden');
    await renderActiveView();
  });

  $('btn-picker-free').addEventListener('click', () => {
    if (state.activePickerLead) {
      launchWhatsAppWithText(state.activePickerLead, null, null);
    }
  });
  $('btn-picker-cancel').addEventListener('click', () => {
    state.activePickerLead = null;
    dom.pickerModal.classList.add('hidden');
  });

  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      state.filter = chip.dataset.filter;
      state.queueFilter = '';
      await renderActiveView();
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      showPendingWhatsAppPrompt();
    }
  });
}

function initCapacitorDeepLinks() {
  if (typeof window === 'undefined' || !window.Capacitor || !window.Capacitor.Plugins) {
    return;
  }
  const localNotifs = window.Capacitor.Plugins.LocalNotifications;
  if (localNotifs && typeof localNotifs.addListener === 'function') {
    localNotifs.addListener('localNotificationActionPerformed', async (event) => {
      const leadId = event && event.notification && event.notification.extra ? event.notification.extra.leadId : '';
      if (!leadId) {
        return;
      }
      state.filter = 'todos';
      state.queueFilter = '';
      await switchView('leads');
      await listRenderer.focusLeadById(leadId);
    });
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    const reg = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
    if (document.readyState === 'complete') {
      reg();
    } else {
      window.addEventListener('load', reg);
    }
  }
}

async function syncStoredTagLabels() {
  const tplModule = await import('./services/template-service.js');
  const labelsMap = {};
  tplModule.getTemplates('all').forEach((tpl) => {
    labelsMap[tpl.id] = tpl.label;
  });
  await syncAllTagLabels(labelsMap);
}

function restorePendingWhatsApp() {
  try {
    const raw = sessionStorage.getItem(PENDING_WA_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (parsed && parsed.leadId) {
      const match = state.leads.find((l) => l.id === parsed.leadId && l.status === 'nuevo');
      if (match) {
        state.pendingWhatsAppLead = parsed;
        showPendingWhatsAppPrompt();
        return;
      }
    }
    sessionStorage.removeItem(PENDING_WA_KEY);
  } catch (error) {
    return;
  }
}

async function initApp() {
  registerServiceWorker();
  bindEvents();
  initCapacitorDeepLinks();
  await syncStoredTagLabels();
  await campaignCtrl.refreshFilterDropdown();
  await refreshLeads();
  restorePendingWhatsApp();
}

initApp();
