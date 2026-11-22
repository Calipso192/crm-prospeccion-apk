import {
  migrateDatabaseToV4, getAllLeads, addQuickNoteToLead, removeQuickNoteFromLead,
  toggleInterestTag, applyLeadChannelTouch, applyLeadTriageOutcome,
  syncAllTagLabels, getAutoBackupMeta, normalizePhone, normalizeInstagram
} from './services/db-service.js';
import { projectLeadForCampaign } from './services/lead-schema.js';
import { evaluateLeadPhase, getInterestTagsCatalog } from './services/phase-engine.js';
import { scheduleNativeReminder, cancelNativeReminder } from './services/reminder-service.js';
import {
  getActiveWaLine, setActiveWaLine, getWaLineLabel, incrementDailyChannel, getChannelSnapshot
} from './services/channel-service.js';
import { renderDashboardView } from './modules/dashboard-view.js';
import { createCalendarScheduler } from './modules/calendar-scheduler.js';
import { createCampaignController } from './modules/campaign-controller.js';
import { createSelectionController } from './modules/selection-controller.js';
import { createListRenderer } from './modules/list-renderer.js';
import { createFormModalsController } from './modules/form-modals-controller.js';
import { showAppToast } from './modules/modal-tools.js';
import {
  syncStageTabCounts,
  cycleLeadContactMethod,
  createScorePickerController,
  initCapacitorAndSw
} from './modules/lead-enrich-ui.js';

const $ = (id) => document.getElementById(id);
const PENDING_WA_KEY = 'crm_prospeccion_pending_wa_v2';

const state = {
  masterLeads: [], leads: [], activeView: 'dashboard', filter: 'todos', queueFilter: '',
  rubro: 'todos', contactMethod: 'todos', sortOrder: 'default',
  interestFilter: 'todas', campaignTplId: 'todas', campaignState: 'pendiente',
  searchQuery: '', pendingWhatsAppLead: null, activePickerLead: null,
  quickStatusLead: null, reminderTargetLead: null,
  draftReminder: { reminderAt: '', reminderReason: '' },
  selectionMode: false, selectedIds: []
};

const dom = {
  leadCounter: $('lead-counter'), revenueCounter: $('revenue-counter'),
  tabDashboard: $('tab-dashboard'), tabLeads: $('tab-leads'),
  dashboardView: $('dashboard-view'), leadsView: $('leads-view'),
  leadsChannelStrip: $('leads-channel-strip'),
  queueFilterBanner: $('queue-filter-banner'), queueFilterText: $('queue-filter-text'),
  searchInput: $('search-input'), btnClearSearch: $('btn-clear-search'),
  formModal: $('lead-form-modal'), formTitle: $('form-title'), formFeedback: $('form-feedback'),
  leadForm: $('lead-form'), leadId: $('lead-id'), leadName: $('lead-name'),
  leadPhone: $('lead-phone'), leadInstagram: $('lead-instagram'), leadRubro: $('lead-rubro'),
  leadScore: $('lead-score'), leadContactMethod: $('lead-contact-method'),
  leadStatus: $('lead-status'), saleAmountGroup: $('sale-amount-group'),
  leadAmount: $('lead-amount'), leadNotes: $('lead-notes'),
  formReminderPreview: $('form-reminder-preview'), reminderModal: $('reminder-modal'),
  reminderLeadLabel: $('reminder-lead-label'), leadsList: $('leads-list'),
  quickStatusModal: $('quick-status-modal'), quickStatusTitle: $('quick-status-title'),
  quickStatusLeadName: $('quick-status-lead-name'), quickSaleBox: $('quick-sale-box'),
  quickSaleAmount: $('quick-sale-amount'), modal: $('custom-modal'),
  modalTitle: $('modal-title'), modalMessage: $('modal-message'),
  statusModal: $('status-modal'), statusModalMessage: $('status-modal-message'),
  btnStatusContacted: $('btn-status-contacted'), btnStatusNoWa: $('btn-status-no-wa'),
  pickerModal: $('template-picker-modal'), pickerLeadName: $('picker-lead-name'),
  pickerWaLines: $('picker-wa-lines'), pickerButtonsList: $('picker-buttons-list'),
  managerModal: $('template-manager-modal'), templatesEditorList: $('templates-editor-list'),
  newTemplateForm: $('new-template-form'), newTplLabel: $('new-tpl-label'),
  newTplPhase: $('new-tpl-phase'), newTplRubro: $('new-tpl-rubro'), newTplText: $('new-tpl-text'),
  interestManagerModal: $('interest-manager-modal'), interestManagerFeedback: $('interest-manager-feedback'),
  interestTagsEditorList: $('interest-tags-editor-list'), newInterestTagForm: $('new-interest-tag-form'),
  newIntLabel: $('new-int-label'), newIntTone: $('new-int-tone'),
  backupModal: $('backup-modal'), backupFeedback: $('backup-feedback'),
  bulkLeadsText: $('bulk-leads-text'), bulkDefaultRubro: $('bulk-default-rubro')
};

const scheduler = createCalendarScheduler({
  quickHoursChips: $('cal-quick-hours'), dayChips: $('cal-day-chips'), customDate: $('cal-custom-date'),
  hourChips: $('cal-hour-chips'), minuteChips: $('cal-minute-chips'), reasonChips: $('cal-reason-chips'),
  reasonInput: $('cal-reason-input'), preview: $('cal-selected-preview'),
  btnClear: $('btn-clear-calendar'), btnOpenCalendar: $('btn-form-calendar')
}, () => {
  const t = state.reminderTargetLead;
  if (t) { return { name: t.name, phone: t.phone, instagram: t.instagram, baseNotes: t.baseNotes }; }
  return {
    name: dom.leadName.value, phone: normalizePhone(dom.leadPhone.value),
    instagram: normalizeInstagram(dom.leadInstagram ? dom.leadInstagram.value : ''), baseNotes: dom.leadNotes.value
  };
});

const campaignCtrl = createCampaignController({
  rubroFilter: $('rubro-filter'), interestFilter: $('interest-filter'), campaignTplFilter: $('campaign-tpl-filter'),
  campaignStatusRow: $('campaign-status-row'), tagPickerModal: $('tag-picker-modal'), tagPickerTitle: $('tag-picker-title'),
  tagPickerLeadName: $('tag-picker-lead-name'), tagRetroactiveRow: $('tag-retroactive-row'), tagPickerList: $('tag-picker-list'),
  btnTagPickerCancel: $('btn-tag-picker-cancel'), bulkTagModal: $('bulk-tag-modal'), bulkTagTplName: $('bulk-tag-tpl-name'),
  bulkTagFeedback: $('bulk-tag-feedback'), bulkTagRetroSelect: $('bulk-tag-retro-select'), bulkStatusChecks: $('bulk-status-checks'),
  btnCancelBulkTag: $('btn-cancel-bulk-tag'), btnConfirmBulkTag: $('btn-confirm-bulk-tag'),
  newCampaignModal: $('new-campaign-modal'), newCampaignForm: $('new-campaign-form'), newCampaignName: $('new-campaign-name'),
  newCampaignDesc: $('new-campaign-desc'), newCampaignClone: $('new-campaign-clone'), newCampaignFeedback: $('new-campaign-feedback'),
  campModeAllCount: $('camp-mode-all-count'), campModeBuyersCount: $('camp-mode-buyers-count'),
  btnCancelNewCampaign: $('btn-cancel-new-campaign'), btnSubmitNewCampaign: $('btn-submit-new-campaign')
}, state, {
  onFilterChange: () => renderActiveView(),
  onDataChanged: () => refreshLeads(),
  getMasterLeads: () => state.masterLeads,
  onNotify: (msg) => showAppToast(msg, false)
});

const selectionCtrl = createSelectionController({
  bulkSelectionBar: $('bulk-selection-bar'), bulkSelCount: $('bulk-sel-count'), btnBulkSelAll: $('btn-bulk-sel-all'),
  btnBulkSelCancel: $('btn-bulk-sel-cancel'), btnBulkSelTag: $('btn-bulk-sel-tag'), btnBulkSelRubro: $('btn-bulk-sel-rubro'),
  btnBulkSelStatus: $('btn-bulk-sel-status'), rubroPickerModal: $('rubro-picker-modal'), rubroPickerTitle: $('rubro-picker-title'),
  rubroPickerSubtitle: $('rubro-picker-subtitle'), rubroPickerOptions: $('rubro-picker-options'), btnRubroPickerCancel: $('btn-rubro-picker-cancel')
}, state, {
  onRender: () => listRenderer.render(state.leads),
  onSyncSelectionUi: () => listRenderer.syncSelectionUi(),
  onDataChanged: () => refreshLeads(),
  getVisibleLeadIds: () => listRenderer.getVisibleIds(),
  onOpenBulkTagPicker: (ids) => campaignCtrl.openBulkSelectedTagModal(ids, () => selectionCtrl.exitSelection()),
  onOpenBulkStatusModal: (count) => modalsCtrl.openBulkStatusModal(count)
});

async function ensureCampaignMutable() {
  const tplMod = await import('./services/template-service.js');
  const active = tplMod.getActiveCampaign();
  if (active && active.status === 'cerrada') {
    showAppToast('Campaña cerrada: reábrela en el Dashboard para modificar contactos.', true);
    return false;
  }
  return true;
}

function withMutable(fn) {
  return async (...args) => {
    if (await ensureCampaignMutable()) { return fn(...args); }
  };
}

async function runChannelTouch(lead, channelKey, openFn, toastPrefix) {
  if (!openFn(lead)) { return; }
  const tplMod = await import('./services/template-service.js');
  const active = tplMod.getActiveCampaign();
  if (active && active.status === 'cerrada') { return; }
  const count = incrementDailyChannel(channelKey);
  await applyLeadChannelTouch(lead.id, active.id, channelKey);
  await refreshLeads();
  showAppToast(toastPrefix + ' · ' + count + ' hoy', false);
}

const scorePickerCtrl = createScorePickerController(
  $('score-picker-modal'), $('score-picker-title'), $('score-picker-chips'),
  $('score-picker-input'), $('btn-score-save'), $('btn-score-clear'), $('btn-score-cancel'),
  async () => { await refreshLeads(); showAppToast('Score IA actualizado', false); }
);

const listRenderer = createListRenderer({ leadsList: dom.leadsList }, state, (waMod, tagLabelsMap) => ({
  tagLabelsMap: tagLabelsMap,
  onEnterSelection: (lead) => selectionCtrl.enterSelection(lead),
  onToggleSelect: (lead) => selectionCtrl.toggleSelect(lead),
  onPickRubro: withMutable((lead) => selectionCtrl.openSingleRubroPicker(lead)),
  onPickScore: withMutable((lead) => scorePickerCtrl.open(lead)),
  onCycleContactMethod: withMutable((lead) => cycleLeadContactMethod(lead, async (m) => {
    await refreshLeads();
    showAppToast('Canal recomendado: ' + m, false);
  })),
  onQuickStatus: withMutable((lead) => modalsCtrl.openQuickStatusModal(lead)),
  onWhatsApp: (lead) => openTemplatePicker(lead),
  onInstagram: async (lead) => {
    const msg = waMod.getOutboundMessage(lead);
    const copied = await waMod.copyTextToClipboard(msg);
    runChannelTouch(lead, 'instagram', waMod.openInstagramProfile, copied ? 'Mensaje copiado al portapapeles. Pégalo en el DM' : 'Instagram DM abierto');
  },
  onCall: (lead) => runChannelTouch(lead, 'llamada', waMod.openPhoneCall, 'Llamada iniciada'),
  onSearch: (lead) => waMod.searchProspectOnline(lead),
  onOpenReminderModal: withMutable((lead) => modalsCtrl.openReminderModalForLead(lead)),
  onTriageHuman: withMutable(async (lead) => {
    await applyLeadTriageOutcome(lead.id, lead.campaignId, 'seguimiento', false); await refreshLeads(); showAppToast(lead.name + ' pasó a Seguimiento', false);
  }),
  onTriageDiscard: withMutable(async (lead, isMetaBot) => {
    await applyLeadTriageOutcome(lead.id, lead.campaignId, 'descartado', isMetaBot); await refreshLeads(); showAppToast(lead.name + ' descartado' + (isMetaBot ? ' (marcado Bot Meta)' : ''), false);
  }),
  onToggleInterestTag: withMutable(async (lead, tagObj) => {
    const y = window.scrollY; await toggleInterestTag(lead.id, lead.campaignId, tagObj); await refreshLeads(); window.scrollTo(0, y);
  }),
  onAddQuickNote: withMutable(async (lead, noteText) => {
    await addQuickNoteToLead(lead.id, lead.campaignId, noteText);
    await refreshLeads();
  }),
  onRemoveQuickNote: withMutable(async (lead, noteId) => {
    await removeQuickNoteFromLead(lead.id, lead.campaignId, noteId);
    await refreshLeads();
  }),
  onRemoveTag: withMutable((lead, tag) => campaignCtrl.removeTag(lead, tag)),
  onOpenAddTag: withMutable((lead) => campaignCtrl.openManualTagModal(lead)),
  onEdit: (lead) => modalsCtrl.openForm(lead),
  onDelete: (lead) => modalsCtrl.openDeleteModal(lead)
}));

const modalsCtrl = createFormModalsController(dom, state, scheduler, campaignCtrl, selectionCtrl, {
  onRefreshLeads: () => refreshLeads(),
  onRenderActiveView: () => renderActiveView(),
  onSyncTagLabels: () => syncStoredTagLabels(),
  onScheduleNativeReminder: (lead) => scheduleNativeReminder(lead),
  onCancelNativeReminder: (id) => cancelNativeReminder(id),
  onShowToast: (msg, isErr) => showAppToast(msg, isErr)
});

const QUEUE_NAMES = {
  seg_urgente: 'Seguimientos vencidos y de hoy',
  nuevo_pendiente: 'Nuevos por contactar',
  contactado_triage: 'Contactados en triage',
  sin_whatsapp_alt: 'Sin WhatsApp (IG o Llamada)'
};

function syncFilterChipsUi() {
  syncStageTabCounts(state.leads);
  document.querySelectorAll('.filter-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === state.filter);
  });
  if (state.queueFilter) {
    let label = QUEUE_NAMES[state.queueFilter] ? QUEUE_NAMES[state.queueFilter] : '';
    if (!label && state.queueFilter.startsWith('int_')) {
      const foundTag = getInterestTagsCatalog().find((t) => t.id === state.queueFilter);
      label = foundTag ? foundTag.label : 'Etiqueta de interés activa';
    }
    dom.queueFilterText.textContent = 'Cola activa: ' + (label ? label : 'Filtro activo');
    dom.queueFilterBanner.classList.remove('hidden');
  } else {
    dom.queueFilterBanner.classList.add('hidden');
  }
}

function buildWaLineButtons(container, snap, chipClass, labelFormat, onPicked) {
  container.innerHTML = '';
  snap.waLines.forEach((line) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = line.id === snap.activeWaLine ? chipClass + ' active' : chipClass;
    btn.textContent = labelFormat(line);
    btn.addEventListener('click', () => {
      setActiveWaLine(line.id);
      onPicked();
    });
    container.appendChild(btn);
  });
}

function renderChannelStrip() {
  if (!dom.leadsChannelStrip) { return; }
  const snap = getChannelSnapshot();
  dom.leadsChannelStrip.innerHTML = '';
  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'leads-wa-chips';
  buildWaLineButtons(chipsWrap, snap, 'leads-wa-chip', (l) => l.label + ' (' + l.count + '/' + l.limit + ')', () => renderActiveView());
  dom.leadsChannelStrip.appendChild(chipsWrap);

  const dailySpan = document.createElement('span');
  dailySpan.className = 'leads-strip-counters';
  dailySpan.textContent = 'IG: ' + snap.todayInstagram + ' · Tel: ' + snap.todayCalls + ' hoy';
  dom.leadsChannelStrip.appendChild(dailySpan);
}

function renderPickerWaLines() {
  if (!dom.pickerWaLines) { return; }
  buildWaLineButtons(dom.pickerWaLines, getChannelSnapshot(), 'picker-wa-chip', (l) => l.label + ' · ' + l.count + '/' + l.limit, () => {
    renderPickerWaLines();
    renderChannelStrip();
  });
}

async function switchView(targetView) {
  state.activeView = targetView === 'leads' ? 'leads' : 'dashboard';
  const isDash = state.activeView === 'dashboard';
  dom.tabDashboard.classList.toggle('active', isDash);
  dom.tabLeads.classList.toggle('active', !isDash);
  dom.dashboardView.classList.toggle('hidden', !isDash);
  dom.leadsView.classList.toggle('hidden', isDash);
  if (!isDash && state.selectionMode) { selectionCtrl.exitSelection(); }
  await renderActiveView();
}

function updateTopBadges() {
  const totalCount = state.leads.length;
  dom.leadCounter.textContent = totalCount === 1 ? '1 prospecto' : totalCount + ' prospectos';
  let revenue = 0;
  state.leads.forEach((item) => {
    const st = item.stage ? item.stage : item.status;
    if (st === 'vendido' && Number(item.saleAmount) > 0) { revenue += Number(item.saleAmount); }
  });
  dom.revenueCounter.textContent = 'S/ ' + revenue.toFixed(2);
}

async function renderActiveView() {
  updateTopBadges();
  syncFilterChipsUi();
  const channelSnapshot = getChannelSnapshot();
  if (state.activeView === 'dashboard') {
    const tplMod = await import('./services/template-service.js');
    const campState = {
      campaigns: tplMod.getCampaigns(),
      activeCampaignId: tplMod.getActiveCampaignId(),
      activeCampaign: tplMod.getActiveCampaign()
    };
    renderDashboardView(dom.dashboardView, state.leads, campState, getAutoBackupMeta(), channelSnapshot, {
      onSelectWaLine: async (lineId) => { setActiveWaLine(lineId); await renderActiveView(); },
      onSelectQueueFilter: async (qKey, stKey) => { state.filter = stKey ? stKey : 'todos'; state.queueFilter = qKey; await switchView('leads'); },
      onSelectStageFilter: async (stKey) => { state.filter = stKey ? stKey : 'todos'; state.queueFilter = ''; await switchView('leads'); },
      onOpenNewCampaign: () => campaignCtrl.openNewCampaignModal(),
      onSwitchCampaign: async (campId) => campaignCtrl.switchCampaign(campId),
      onToggleCampaignStatus: (camp) => {
        const isClosed = camp.status === 'cerrada';
        const nextStatus = isClosed ? 'activa' : 'cerrada';
        const msg = isClosed
          ? '¿Deseas reabrir "' + camp.name + '" para seguir registrando y moviendo prospectos?'
          : '¿Deseas cerrar "' + camp.name + '"? Sus métricas y ventas quedarán guardadas intactas.';
        modalsCtrl.openConfirmModal(isClosed ? 'Reabrir Campaña' : 'Cerrar Campaña', msg, isClosed ? 'Reabrir' : 'Cerrar campaña', async () => {
          tplMod.setCampaignStatus(camp.id, nextStatus);
          await renderActiveView();
          showAppToast('Campaña "' + camp.name + '" ' + (isClosed ? 'reabierta.' : 'cerrada.'), false);
        });
      },
      onOpenInterestManager: () => modalsCtrl.openInterestManagerModal(),
      onQuickExportBackup: async () => {
        const tools = await import('./modules/modal-tools.js');
        await tools.exportBackupJson(state.masterLeads, null);
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
  renderChannelStrip();
  await listRenderer.render(state.leads);
}

async function refreshLeads() {
  const tplMod = await import('./services/template-service.js');
  const activeId = tplMod.getActiveCampaignId();
  const campaignsById = {};
  tplMod.getCampaigns().forEach((c) => { campaignsById[c.id] = c; });
  state.masterLeads = await getAllLeads(activeId);
  state.leads = state.masterLeads.map((m) => projectLeadForCampaign(m, activeId, campaignsById)).filter(Boolean);
  await renderActiveView();
}

function showPendingWhatsAppPrompt() {
  const p = state.pendingWhatsAppLead;
  if (!p) { return; }
  const lineLabel = getWaLineLabel(p.waLineUsed);
  dom.statusModalMessage.textContent = '¿Se envió el mensaje a ' + (p.leadName ? p.leadName : 'este contacto') + ' usando ' + lineLabel + '?';
  const isInitial = ['nuevo', 'sin_whatsapp'].includes(p.currentStage);
  if (dom.btnStatusContacted) {
    dom.btnStatusContacted.textContent = isInitial ? 'Se envió por ' + lineLabel + ' (Marcar Contactado)' : 'Confirmar envío por ' + lineLabel;
  }
  if (dom.btnStatusNoWa) { dom.btnStatusNoWa.classList.toggle('hidden', !isInitial); }
  dom.statusModal.classList.remove('hidden');
}

async function launchWhatsAppWithText(lead, customText, tpl) {
  state.activePickerLead = null;
  dom.pickerModal.classList.add('hidden');
  if (!(await ensureCampaignMutable())) { return; }
  const waModule = await import('./services/whatsapp-service.js');
  const finalMsg = (customText !== undefined && customText !== null && String(customText).trim()) ? String(customText).trim() : waModule.getOutboundMessage(lead);
  await waModule.copyTextToClipboard(finalMsg);
  if (!waModule.openWhatsAppChat(lead, finalMsg)) { return; }
  const pending = {
    leadId: lead.id, leadName: lead.name, currentStage: lead.stage ? lead.stage : lead.status,
    campaignId: lead.campaignId, waLineUsed: getActiveWaLine(),
    tpl: tpl && tpl.id ? { id: tpl.id, label: tpl.label, phase: Number(tpl.phase) > 0 ? Number(tpl.phase) : 0 } : null
  };
  state.pendingWhatsAppLead = pending;
  try { sessionStorage.setItem(PENDING_WA_KEY, JSON.stringify(pending)); } catch (e) { return; }
}

async function openTemplatePicker(lead) {
  if (!(await ensureCampaignMutable())) { return; }
  state.activePickerLead = lead;
  const phaseInfo = evaluateLeadPhase(lead);
  dom.pickerLeadName.textContent = lead.name;
  renderPickerWaLines();
  dom.pickerButtonsList.innerHTML = '';
  const addPickerBtn = (label, cls, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label;
    b.addEventListener('click', onClick);
    dom.pickerButtonsList.appendChild(b);
  };
  const waModule = await import('./services/whatsapp-service.js');
  const notesMsg = waModule.getNotesOutboundMessage(lead);
  if (notesMsg) { addPickerBtn('Mensaje de Notas (Guion)', 'btn-whatsapp', () => launchWhatsAppWithText(lead, notesMsg, null)); }
  if (lead.suggestedMessage && String(lead.suggestedMessage).trim() !== notesMsg) {
    addPickerBtn('Mensaje Jarvis Listo', 'btn-whatsapp', () => launchWhatsAppWithText(lead, lead.suggestedMessage, null));
  }
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
    eligible.forEach((tpl) => addPickerBtn(tpl.label, tpl.phase === phaseInfo.suggestedPhase ? 'btn-whatsapp' : 'btn-secondary', () => launchWhatsAppWithText(lead, tplModule.renderTemplateText(tpl.text, lead), tpl)));
  }
  dom.pickerModal.classList.remove('hidden');
}

function bindEvents() {
  scheduler.bind(); campaignCtrl.bind(); selectionCtrl.bind(); modalsCtrl.bind(); scorePickerCtrl.bind();
  const cmFilter = $('contact-method-filter');
  if (cmFilter) { cmFilter.addEventListener('change', async () => { state.contactMethod = cmFilter.value; await renderActiveView(); }); }
  const sortFilter = $('sort-order-filter');
  if (sortFilter) { sortFilter.addEventListener('change', async () => { state.sortOrder = sortFilter.value; await renderActiveView(); }); }

  dom.tabDashboard.addEventListener('click', () => switchView('dashboard'));
  dom.tabLeads.addEventListener('click', () => switchView('leads'));
  $('btn-clear-queue-filter').addEventListener('click', async () => { state.queueFilter = ''; await renderActiveView(); });

  let searchTimer = null;
  dom.searchInput.addEventListener('input', () => {
    state.searchQuery = dom.searchInput.value;
    dom.btnClearSearch.classList.toggle('hidden', state.searchQuery.length === 0);
    if (searchTimer) { clearTimeout(searchTimer); }
    searchTimer = setTimeout(async () => {
      if (state.searchQuery.trim().length > 0 && state.activeView === 'dashboard') { await switchView('leads'); return; }
      await renderActiveView();
    }, 220);
  });

  dom.btnClearSearch.addEventListener('click', async () => {
    dom.searchInput.value = ''; state.searchQuery = ''; dom.btnClearSearch.classList.add('hidden'); await renderActiveView();
  });

  $('btn-picker-free').addEventListener('click', () => {
    if (state.activePickerLead) { launchWhatsAppWithText(state.activePickerLead, null, null); }
  });
  $('btn-picker-cancel').addEventListener('click', () => { state.activePickerLead = null; dom.pickerModal.classList.add('hidden'); });

  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', async () => { state.filter = chip.dataset.filter; state.queueFilter = ''; await renderActiveView(); });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      showPendingWhatsAppPrompt();
      triggerSilentBlapSync();
    }
  });
}

async function syncStoredTagLabels() {
  const tplModule = await import('./services/template-service.js');
  const labelsMap = {};
  tplModule.getTemplates('all').forEach((tpl) => { labelsMap[tpl.id] = tpl.label; });
  await syncAllTagLabels(labelsMap);
}

function restorePendingWhatsApp() {
  try {
    const raw = sessionStorage.getItem(PENDING_WA_KEY);
    if (!raw) { return; }
    const parsed = JSON.parse(raw);
    if (parsed && parsed.leadId && state.masterLeads.some((l) => l.id === parsed.leadId)) {
      state.pendingWhatsAppLead = parsed;
      showPendingWhatsAppPrompt();
      return;
    }
    sessionStorage.removeItem(PENDING_WA_KEY);
  } catch (error) { return; }
}

async function triggerSilentBlapSync() {
  const tools = await import('./modules/modal-tools.js');
  await tools.runSilentCapacitorAutoSync(async () => {
    await syncStoredTagLabels();
    await campaignCtrl.refreshFilterDropdown();
    await refreshLeads();
  });
}

async function initApp() {
  initCapacitorAndSw(triggerSilentBlapSync, async (leadId) => {
    state.filter = 'todos'; state.queueFilter = ''; await switchView('leads'); await listRenderer.focusLeadById(leadId);
  });
  bindEvents();
  const tplMod = await import('./services/template-service.js');
  await migrateDatabaseToV4(tplMod.getActiveCampaignId());
  await syncStoredTagLabels();
  await campaignCtrl.refreshFilterDropdown();
  await refreshLeads();
  restorePendingWhatsApp();
  await triggerSilentBlapSync();
}

initApp();
