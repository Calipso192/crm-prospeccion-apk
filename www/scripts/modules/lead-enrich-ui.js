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

function ensurePermissionPromptModal() {
  let modal = document.getElementById('native-perm-modal');
  if (modal) { return modal; }
  modal = document.createElement('div');
  modal.id = 'native-perm-modal';
  modal.className = 'modal hidden';
  const card = document.createElement('div');
  card.className = 'modal-card';
  const title = document.createElement('h3');
  title.id = 'native-perm-title';
  const msg = document.createElement('p');
  msg.id = 'native-perm-msg';
  msg.className = 'helper-hint';
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const btnLater = document.createElement('button');
  btnLater.type = 'button';
  btnLater.id = 'btn-native-perm-later';
  btnLater.className = 'btn-secondary';
  btnLater.textContent = 'Después';
  const btnActivate = document.createElement('button');
  btnActivate.type = 'button';
  btnActivate.id = 'btn-native-perm-activate';
  btnActivate.className = 'btn-whatsapp';
  btnActivate.textContent = 'Activar ahora';
  actions.appendChild(btnLater);
  actions.appendChild(btnActivate);
  card.appendChild(title);
  card.appendChild(msg);
  card.appendChild(actions);
  modal.appendChild(card);
  document.body.appendChild(modal);
  return modal;
}

function checkNativePermissionsPrompt() {
  const bridge = typeof window !== 'undefined' ? window.CrmNativePerms : null;
  if (!bridge) { return; }
  const needsFiles = typeof bridge.hasAllFilesPermission === 'function' && !bridge.hasAllFilesPermission();
  const needsNotif = typeof bridge.hasNotificationPermission === 'function' && !bridge.hasNotificationPermission();
  const existing = document.getElementById('native-perm-modal');
  if (!needsFiles && !needsNotif) {
    if (existing) { existing.classList.add('hidden'); }
    return;
  }
  if (sessionStorage.getItem('crm_perm_dismissed') === '1') { return; }
  const modal = ensurePermissionPromptModal();
  const titleEl = document.getElementById('native-perm-title');
  const msgEl = document.getElementById('native-perm-msg');
  const btnActivate = document.getElementById('btn-native-perm-activate');
  const btnLater = document.getElementById('btn-native-perm-later');
  titleEl.textContent = needsFiles ? 'Permiso de archivos requerido' : 'Permiso de notificaciones requerido';
  msgEl.textContent = needsFiles
    ? 'Por favor activa "Acceso a todos los archivos" para que CRM BLAP sincronice tus prospectos desde BLAP-Sync automáticamente.'
    : 'Por favor activa las notificaciones para recibir tus recordatorios de seguimiento.';
  btnActivate.onclick = () => {
    modal.classList.add('hidden');
    if (needsFiles && typeof bridge.openAllFilesSettings === 'function') {
      bridge.openAllFilesSettings();
      return;
    }
    if (needsNotif && typeof bridge.requestNotificationPermission === 'function') {
      bridge.requestNotificationPermission();
    }
  };
  btnLater.onclick = () => {
    sessionStorage.setItem('crm_perm_dismissed', '1');
    modal.classList.add('hidden');
  };
  modal.classList.remove('hidden');
}

export function initCapacitorAndSw(onAutoSync, onFocusLead) {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  const isNativeCap = Boolean(cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : cap.Plugins));
  if ('serviceWorker' in navigator) {
    if (isNativeCap) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister().catch(() => {}));
      }).catch(() => {});
      if (typeof caches !== 'undefined') {
        caches.keys().then((keys) => {
          keys.forEach((k) => caches.delete(k).catch(() => {}));
        }).catch(() => {});
      }
    } else {
      const reg = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
      if (document.readyState === 'complete') { reg(); } else { window.addEventListener('load', reg); }
    }
  }
  checkNativePermissionsPrompt();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { checkNativePermissionsPrompt(); }
  });
  const plugins = typeof window !== 'undefined' && window.Capacitor ? window.Capacitor.Plugins : null;
  if (!plugins) { return; }
  if (plugins.App && typeof plugins.App.addListener === 'function') {
    plugins.App.addListener('appUrlOpen', (ev) => {
      if (ev && String(ev.url ? ev.url : '').startsWith('crmblap://autosync') && onAutoSync) { onAutoSync(); }
    });
  }
  if (plugins.LocalNotifications && typeof plugins.LocalNotifications.addListener === 'function') {
    plugins.LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
      const leadId = event && event.notification && event.notification.extra ? event.notification.extra.leadId : '';
      if (leadId && onFocusLead) { await onFocusLead(leadId); }
    });
  }
}
