const DEFAULT_COUNTRY_CODE = '51';

export function sanitizePhone(rawPhone) {
  if (!rawPhone) {
    return '';
  }
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) {
    return DEFAULT_COUNTRY_CODE + digits;
  }
  return digits;
}

function isCapacitorNative() {
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

function openExternalTarget(targetUrl) {
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
  if (!contextNote && lead && lead.notes) {
    contextNote = String(lead.notes).trim();
  }
  const intro = 'Hola ' + name + ', un gusto saludarte.';
  if (contextNote) {
    return intro + ' ' + contextNote;
  }
  return intro;
}

export function openWhatsAppChat(lead, customMessage) {
  const cleanPhone = sanitizePhone(lead.phone);
  if (!cleanPhone) {
    return false;
  }
  const finalMessage = customMessage !== undefined && customMessage !== null
    ? String(customMessage)
    : buildFreeMessage(lead);
  const queryPart = finalMessage ? '?text=' + encodeURIComponent(finalMessage) : '';
  const targetUrl = 'https://wa.me/' + cleanPhone + queryPart;
  return openExternalTarget(targetUrl);
}

export function openWhatsAppDirect(lead) {
  return openWhatsAppChat(lead, '');
}

export function openPhoneCall(lead) {
  const cleanPhone = sanitizePhone(lead.phone);
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
