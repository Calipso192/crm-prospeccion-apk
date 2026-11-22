import { normalizePhone, normalizeInstagram } from './lead-schema.js';
import { getTemplates, renderTemplateText } from './template-service.js';

export const sanitizePhone = normalizePhone;
export const sanitizeInstagram = normalizeInstagram;

export function cleanScriptText(rawText) {
  if (!rawText) {
    return '';
  }
  let cleaned = String(rawText).trim();
  cleaned = cleaned.replace(/^\[\d{2,4}[/-]\d{2}(?:[/-]\d{2,4})?(?:\s+\d{1,2}:\d{2})?\]\s*/g, '');
  cleaned = cleaned.replace(/^mensaje\s*\/\s*guion\s*:\s*/i, '');
  return cleaned.trim();
}

export function getNotesOutboundMessage(contact) {
  if (!contact) {
    return '';
  }
  const rawBase = contact.baseNotes ? contact.baseNotes : contact.notes;
  if (rawBase && String(rawBase).trim()) {
    return cleanScriptText(rawBase);
  }
  const qNotes = Array.isArray(contact.quickNotes) ? contact.quickNotes : [];
  for (let i = 0; i < qNotes.length; i += 1) {
    const item = qNotes[i];
    const txt = item && typeof item === 'object' ? item.text : item;
    if (txt && /mensaje\s*\/\s*guion\s*:/i.test(String(txt))) {
      const extracted = cleanScriptText(txt);
      if (extracted) {
        return extracted;
      }
    }
  }
  return '';
}

function getDefaultCampaignTemplateMessage(contact) {
  const templates = getTemplates();
  if (!Array.isArray(templates) ? true : templates.length === 0) {
    return '';
  }
  const leadRubro = contact && contact.rubro ? String(contact.rubro).trim().toLowerCase() : '';
  const eligible = templates.filter((tpl) => !(tpl.rubro && leadRubro && tpl.rubro !== leadRubro));
  const pool = eligible.length > 0 ? eligible : templates;
  const sorted = pool.slice().sort((a, b) => {
    const scoreA = (a.phase === 1 ? 4 : (a.phase === 0 ? 1 : 0)) + (leadRubro && a.rubro === leadRubro ? 2 : 0);
    const scoreB = (b.phase === 1 ? 4 : (b.phase === 0 ? 1 : 0)) + (leadRubro && b.rubro === leadRubro ? 2 : 0);
    return scoreB - scoreA;
  });
  return sorted[0] && sorted[0].text ? renderTemplateText(sorted[0].text, contact) : '';
}

export function getOutboundMessage(contact) {
  const fromNotes = getNotesOutboundMessage(contact);
  if (fromNotes) {
    return fromNotes;
  }
  const fromTemplate = getDefaultCampaignTemplateMessage(contact);
  if (fromTemplate) {
    return fromTemplate;
  }
  return buildFreeMessage(contact);
}

function fallbackCopyWithTextarea(text) {
  if (typeof document === 'undefined' ? true : !document.body) {
    return false;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.left = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = Boolean(document.execCommand('copy'));
  } catch (err) {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export async function copyTextToClipboard(rawText) {
  const msg = rawText ? String(rawText).trim() : '';
  if (!msg) {
    return false;
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(msg);
      return true;
    }
  } catch (err) {
    return fallbackCopyWithTextarea(msg);
  }
  return fallbackCopyWithTextarea(msg);
}

export function isCapacitorNative() {
  if (typeof window === 'undefined') {
    return false;
  }
  const cap = window.Capacitor;
  if (!cap) {
    return false;
  }
  if (typeof cap.isNativePlatform === 'function') {
    return Boolean(cap.isNativePlatform());
  }
  return Boolean(cap.isNative);
}

export function openExternalTarget(targetUrl) {
  if (!targetUrl) {
    return false;
  }
  if (isCapacitorNative()) {
    const plugins = window.Capacitor.Plugins;
    if (plugins && plugins.Browser && typeof plugins.Browser.open === 'function') {
      plugins.Browser.open({ url: targetUrl }).catch(() => {
        window.location.href = targetUrl;
      });
      return true;
    }
    const anchor = document.createElement('a');
    anchor.href = targetUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return true;
  }
  const popup = window.open(targetUrl, '_blank', 'noopener,noreferrer');
  if (!popup) {
    window.location.href = targetUrl;
  }
  return true;
}

export function buildFreeMessage(lead) {
  const name = lead && lead.name ? lead.name.trim() : 'hola';
  let contextNote = '';
  if (lead && Array.isArray(lead.quickNotes) && lead.quickNotes.length > 0) {
    contextNote = lead.quickNotes[0].text ? String(lead.quickNotes[0].text).trim() : '';
  }
  if (!contextNote && lead) {
    const rawBase = lead.baseNotes ? lead.baseNotes : lead.notes;
    if (rawBase) {
      contextNote = String(rawBase).trim();
    }
  }
  const intro = 'Hola ' + name + ', un gusto saludarte.';
  if (contextNote) {
    return intro + ' ' + contextNote;
  }
  return intro;
}

export function openWhatsAppChat(lead, customMessage) {
  const cleanPhone = sanitizePhone(lead && lead.phone);
  if (!cleanPhone) {
    return false;
  }
  const finalMessage = customMessage !== undefined && customMessage !== null
    ? String(customMessage)
    : getOutboundMessage(lead);
  const queryPart = finalMessage ? '?text=' + encodeURIComponent(finalMessage) : '';
  const targetUrl = 'https://wa.me/' + cleanPhone + queryPart;
  return openExternalTarget(targetUrl);
}

export function openWhatsAppDirect(lead) {
  return openWhatsAppChat(lead, '');
}

export function openInstagramProfile(lead) {
  const handle = sanitizeInstagram(lead && lead.instagram);
  if (!handle) {
    return false;
  }
  return openExternalTarget('https://instagram.com/' + encodeURIComponent(handle));
}

export async function copySuggestedMessage(lead) {
  const msg = getOutboundMessage(lead);
  return copyTextToClipboard(msg);
}

export function openPhoneCall(lead) {
  const cleanPhone = sanitizePhone(lead && lead.phone);
  if (!cleanPhone) {
    return false;
  }
  window.location.href = 'tel:+' + cleanPhone;
  return true;
}

export function searchProspectOnline(lead) {
  const name = lead && lead.name ? lead.name.trim() : '';
  if (!name) {
    return false;
  }
  const query = encodeURIComponent(name + ' whatsapp instagram facebook');
  const searchUrl = 'https://www.google.com/search?q=' + query;
  return openExternalTarget(searchUrl);
}
