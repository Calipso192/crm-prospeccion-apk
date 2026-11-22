import { updateLeadEnrichFields } from '../services/db-service.js';

const METHOD_ORDER = ['whatsapp', 'instagram', 'llamada'];

export function syncStageTabCounts(leads) {
  const list = Array.isArray(leads) ? leads : [];
  const counts = {
    todos: list.length,
    nuevo: 0,
    contactado: 0,
    seguimiento: 0,
    vendido: 0,
    descartado: 0,
    sin_whatsapp: 0
  };
  list.forEach((lead) => {
    const st = lead.stage ? lead.stage : lead.status;
    if (counts[st] !== undefined) {
      counts[st] += 1;
    }
  });
  document.querySelectorAll('.filter-chip').forEach((btn) => {
    const key = btn.dataset.filter;
    if (!btn.dataset.baseLabel) {
      btn.dataset.baseLabel = btn.textContent.trim();
    }
    const base = btn.dataset.baseLabel;
    const count = counts[key] !== undefined ? counts[key] : 0;
    btn.textContent = base + ' (' + count + ')';
  });
}

export async function cycleLeadContactMethod(lead, onDone) {
  if (!lead || !lead.id) { return; }
  const current = lead.contactMethod ? String(lead.contactMethod) : '';
  const idx = METHOD_ORDER.indexOf(current);
  const nextMethod = idx === -1 ? METHOD_ORDER[0] : METHOD_ORDER[(idx + 1) % METHOD_ORDER.length];
  await updateLeadEnrichFields(lead.id, lead.campaignId, { contactMethod: nextMethod });
  if (onDone) { await onDone(nextMethod); }
}

export function createScorePickerController(modalEl, titleEl, chipsEl, inputEl, btnSave, btnClear, btnCancel, onSaveScore) {
  let activeLead = null;

  function close() {
    activeLead = null;
    if (modalEl) { modalEl.classList.add('hidden'); }
  }

  function open(lead) {
    if (!modalEl || !lead) { return; }
    activeLead = lead;
    if (titleEl) { titleEl.textContent = 'Score IA · ' + lead.name; }
    if (inputEl) {
      inputEl.value = lead.score !== null && lead.score !== undefined ? String(lead.score) : '';
    }
    if (chipsEl) {
      chipsEl.querySelectorAll('[data-score-val]').forEach((btn) => {
        const isSame = lead.score !== null && Number(lead.score) === Number(btn.dataset.scoreVal);
        btn.classList.toggle('active', isSame);
      });
    }
    modalEl.classList.remove('hidden');
  }

  function bind() {
    if (chipsEl) {
      chipsEl.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-score-val]');
        if (!btn || !activeLead) { return; }
        const target = activeLead;
        const val = Number(btn.dataset.scoreVal);
        close();
        await updateLeadEnrichFields(target.id, target.campaignId, { score: val });
        if (onSaveScore) { await onSaveScore(target, val); }
      });
    }
    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        if (!activeLead) { return; }
        const raw = inputEl ? inputEl.value.trim() : '';
        const target = activeLead;
        close();
        const val = raw === '' ? null : Number(raw);
        await updateLeadEnrichFields(target.id, target.campaignId, { score: val });
        if (onSaveScore) { await onSaveScore(target, val); }
      });
    }
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        if (!activeLead) { return; }
        const target = activeLead;
        close();
        await updateLeadEnrichFields(target.id, target.campaignId, { score: null });
        if (onSaveScore) { await onSaveScore(target, null); }
      });
    }
    if (btnCancel) {
      btnCancel.addEventListener('click', close);
    }
  }

  return { open, bind, close };
}

export function initCapacitorAndSw(onAutoSync, onFocusLead) {
  if ('serviceWorker' in navigator) {
    const reg = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
    if (document.readyState === 'complete') { reg(); } else { window.addEventListener('load', reg); }
  }
  const plugins = typeof window !== 'undefined' && window.Capacitor ? window.Capacitor.Plugins : null;
  if (!plugins) { return; }
  if (plugins.App && typeof plugins.App.addListener === 'function') {
    plugins.App.addListener('appUrlOpen', (ev) => {
      if (ev && String(ev.url || '').startsWith('crmblap://autosync') && onAutoSync) { onAutoSync(); }
    });
  }
  if (plugins.LocalNotifications && typeof plugins.LocalNotifications.addListener === 'function') {
    plugins.LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
      const leadId = event && event.notification && event.notification.extra ? event.notification.extra.leadId : '';
      if (leadId && onFocusLead) { await onFocusLead(leadId); }
    });
  }
}
