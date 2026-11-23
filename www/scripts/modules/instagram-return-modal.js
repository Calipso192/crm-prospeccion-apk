import {
  applyLeadChannelTouch,
  updateLeadCampaignStage,
  addQuickNoteToLead
} from '../services/db-service.js';
import { incrementDailyChannel } from '../services/channel-service.js';
import { getActiveCampaignId } from '../services/template-service.js';

const PENDING_IG_KEY = 'crm_prospeccion_pending_ig_v1';
const RESTRICTED_IG_NOTE = 'Perfil restringido o no recibe mensajes en IG';

function createModalDom() {
  const existing = document.getElementById('ig-status-modal');
  if (existing) {
    return {
      overlay: existing,
      message: document.getElementById('ig-status-message'),
      btnSent: document.getElementById('btn-ig-status-sent'),
      btnRestricted: document.getElementById('btn-ig-status-restricted'),
      btnKeep: document.getElementById('btn-ig-status-keep')
    };
  }
  const overlay = document.createElement('div');
  overlay.id = 'ig-status-modal';
  overlay.className = 'modal-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'modal-box';

  const title = document.createElement('h3');
  title.textContent = 'Resultado de Instagram DM';
  box.appendChild(title);

  const message = document.createElement('p');
  message.id = 'ig-status-message';
  box.appendChild(message);

  const actions = document.createElement('div');
  actions.className = 'modal-stack-actions';

  const btnSent = document.createElement('button');
  btnSent.id = 'btn-ig-status-sent';
  btnSent.type = 'button';
  btnSent.className = 'btn-instagram';
  btnSent.textContent = 'Mensaje enviado -> Pasar a Contactado';

  const btnRestricted = document.createElement('button');
  btnRestricted.id = 'btn-ig-status-restricted';
  btnRestricted.type = 'button';
  btnRestricted.className = 'btn-warning';
  btnRestricted.textContent = 'Perfil restringido / No permite DM -> Descartar';

  const btnKeep = document.createElement('button');
  btnKeep.id = 'btn-ig-status-keep';
  btnKeep.type = 'button';
  btnKeep.className = 'btn-secondary';
  btnKeep.textContent = 'Solo revise / No envie -> Dejar en Nuevo';

  actions.appendChild(btnSent);
  actions.appendChild(btnRestricted);
  actions.appendChild(btnKeep);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  return {
    overlay: overlay,
    message: message,
    btnSent: btnSent,
    btnRestricted: btnRestricted,
    btnKeep: btnKeep
  };
}

export function createInstagramReturnController(callbacks) {
  let pendingLead = null;
  let bound = false;
  let dom = null;

  function ensureDom() {
    if (!dom) {
      dom = createModalDom();
    }
    return dom;
  }

  function clearPending() {
    pendingLead = null;
    try {
      sessionStorage.removeItem(PENDING_IG_KEY);
    } catch (error) {
      return;
    }
  }

  function savePending(data) {
    pendingLead = data;
    try {
      sessionStorage.setItem(PENDING_IG_KEY, JSON.stringify(data));
    } catch (error) {
      return;
    }
  }

  function showPrompt() {
    if (!pendingLead) {
      return;
    }
    const ui = ensureDom();
    if (!ui.overlay.classList.contains('hidden')) {
      return;
    }
    const namePart = pendingLead.leadName ? pendingLead.leadName : 'este contacto';
    const handlePart = pendingLead.instagram ? ' (@' + pendingLead.instagram + ')' : '';
    ui.message.textContent = '¿Enviaste el DM en Instagram a ' + namePart + handlePart + '?';
    ui.overlay.classList.remove('hidden');
  }

  async function applyOutcome(outcome) {
    const current = pendingLead;
    clearPending();
    const ui = ensureDom();
    ui.overlay.classList.add('hidden');
    if (!(current && current.leadId)) {
      return;
    }
    if (outcome === 'keep') {
      return;
    }
    const campId = current.campaignId ? current.campaignId : getActiveCampaignId();
    if (outcome === 'sent') {
      await applyLeadChannelTouch(current.leadId, campId, 'instagram');
      const count = incrementDailyChannel('instagram');
      if (callbacks && callbacks.onShowToast) {
        callbacks.onShowToast('Instagram DM enviado · ' + count + ' hoy', false);
      }
      if (callbacks && callbacks.onRefreshLeads) {
        await callbacks.onRefreshLeads();
      }
      return;
    }
    if (outcome === 'restricted') {
      await updateLeadCampaignStage(current.leadId, campId, 'descartado');
      await addQuickNoteToLead(current.leadId, campId, RESTRICTED_IG_NOTE);
      if (callbacks && callbacks.onShowToast) {
        callbacks.onShowToast('Contacto descartado (perfil restringido en IG)', false);
      }
      if (callbacks && callbacks.onRefreshLeads) {
        await callbacks.onRefreshLeads();
      }
    }
  }

  function bind() {
    if (bound) {
      return;
    }
    bound = true;
    const ui = ensureDom();
    ui.btnSent.addEventListener('click', () => applyOutcome('sent'));
    ui.btnRestricted.addEventListener('click', () => applyOutcome('restricted'));
    ui.btnKeep.addEventListener('click', () => applyOutcome('keep'));

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        showPrompt();
      }
    });
    window.addEventListener('focus', () => {
      showPrompt();
    });
  }

  async function launch(lead) {
    if (!(lead && lead.id)) {
      return false;
    }
    const waMod = await import('../services/whatsapp-service.js');
    const msg = waMod.getOutboundMessage(lead);
    await waMod.copyTextToClipboard(msg);
    if (!waMod.openInstagramProfile(lead)) {
      return false;
    }
    savePending({
      leadId: lead.id,
      leadName: lead.name ? lead.name : '',
      instagram: lead.instagram ? lead.instagram : '',
      currentStage: lead.stage ? lead.stage : lead.status,
      campaignId: lead.campaignId ? lead.campaignId : getActiveCampaignId()
    });
    return true;
  }

  function restorePending(masterLeads) {
    try {
      const raw = sessionStorage.getItem(PENDING_IG_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      const list = Array.isArray(masterLeads) ? masterLeads : [];
      if (parsed && parsed.leadId && list.some((item) => item.id === parsed.leadId)) {
        pendingLead = parsed;
        showPrompt();
        return;
      }
      sessionStorage.removeItem(PENDING_IG_KEY);
    } catch (error) {
      return;
    }
  }

  return {
    bind: bind,
    launch: launch,
    restorePending: restorePending
  };
}
