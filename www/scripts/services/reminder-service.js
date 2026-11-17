const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function padTwo(num) {
  return num < 10 ? '0' + num : String(num);
}

function formatDateYmd(dateObj) {
  const y = dateObj.getFullYear();
  const m = padTwo(dateObj.getMonth() + 1);
  const d = padTwo(dateObj.getDate());
  return y + '-' + m + '-' + d;
}

function formatCalendarUtc(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = padTwo(dateObj.getUTCMonth() + 1);
  const d = padTwo(dateObj.getUTCDate());
  const h = padTwo(dateObj.getUTCHours());
  const min = padTwo(dateObj.getUTCMinutes());
  const s = padTwo(dateObj.getUTCSeconds());
  return '' + y + m + d + 'T' + h + min + s + 'Z';
}

function formatHour12(hour, minute) {
  const period = hour >= 12 ? 'p. m.' : 'a. m.';
  const modHour = hour % 12;
  const displayHour = modHour === 0 ? 12 : modHour;
  return displayHour + ':' + padTwo(minute) + ' ' + period;
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

function hashLeadIdToInt(leadId) {
  const str = String(leadId ? leadId : '1');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash * 31) + str.charCodeAt(i)) % 2000000000;
  }
  return Math.abs(hash) + 1000;
}

export function getUpcomingDays(count) {
  const total = count ? count : 7;
  const days = [];
  const base = new Date();
  for (let i = 0; i < total; i += 1) {
    const target = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const dateStr = formatDateYmd(target);
    let label = DAY_NAMES[target.getDay()] + ' ' + target.getDate();
    if (i === 0) {
      label = 'Hoy ' + target.getDate();
    } else if (i === 1) {
      label = 'Mañana ' + target.getDate();
    }
    days.push({ dateStr: dateStr, label: label });
  }
  return days;
}

export function buildReminderIso(dateStr, hour, minute) {
  if (!dateStr) {
    return '';
  }
  const cleanHour = typeof hour === 'number' ? hour : 10;
  const cleanMinute = typeof minute === 'number' ? minute : 0;
  return dateStr + 'T' + padTwo(cleanHour) + ':' + padTwo(cleanMinute);
}

export function buildRelativeHoursIso(hoursAhead) {
  const hrs = Number(hoursAhead) > 0 ? Number(hoursAhead) : 2;
  const target = new Date(Date.now() + (hrs * 3600000));
  const roundedMin = target.getMinutes() >= 30 ? 30 : 0;
  return formatDateYmd(target) + 'T' + padTwo(target.getHours()) + ':' + padTwo(roundedMin);
}

export function parseReminderParts(reminderStr) {
  if (!reminderStr) {
    return null;
  }
  const parts = String(reminderStr).split('T');
  const dateParts = parts[0].split('-');
  if (dateParts.length !== 3) {
    return null;
  }
  const year = Number(dateParts[0]);
  const month = Number(dateParts[1]);
  const day = Number(dateParts[2]);
  if (Number.isNaN(year)) {
    return null;
  }
  if (Number.isNaN(month)) {
    return null;
  }
  if (Number.isNaN(day)) {
    return null;
  }
  let hour = 10;
  let minute = 0;
  if (parts[1]) {
    const timeParts = parts[1].split(':');
    const parsedH = Number(timeParts[0]);
    const parsedM = Number(timeParts[1]);
    if (!Number.isNaN(parsedH)) {
      hour = parsedH;
    }
    if (!Number.isNaN(parsedM)) {
      minute = parsedM;
    }
  }
  const dateObj = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(dateObj.getTime())) {
    return null;
  }
  return {
    dateStr: parts[0],
    hour: hour,
    minute: minute,
    dateObj: dateObj
  };
}

export function formatReminderLabel(reminderStr, reason) {
  const parsed = parseReminderParts(reminderStr);
  if (!parsed) {
    return '';
  }
  const d = parsed.dateObj;
  const dayLabel = DAY_NAMES[d.getDay()] + ' ' + padTwo(d.getDate()) + '/' + padTwo(d.getMonth() + 1);
  const timeLabel = formatHour12(parsed.hour, parsed.minute);
  const cleanReason = reason ? String(reason).trim() : '';
  const suffix = cleanReason ? ' · ' + cleanReason : '';
  return dayLabel + ' · ' + timeLabel + suffix;
}

export function formatRelativeTimeAgo(timestampMs) {
  const ts = Number(timestampMs);
  if (!ts || Number.isNaN(ts)) {
    return 'Sin registro';
  }
  const diffMs = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) {
    return mins <= 1 ? 'Hace 1 min' : 'Hace ' + mins + ' min';
  }
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 24) {
    return hours === 1 ? 'Hace 1h' : 'Hace ' + hours + 'h';
  }
  const days = Math.floor(diffMs / 86400000);
  return days === 1 ? 'Hace 1 día' : 'Hace ' + days + ' días';
}

export function buildGoogleCalendarUrl(lead, overrideReminderAt, overrideReason) {
  const rawDate = overrideReminderAt ? overrideReminderAt : lead.reminderAt;
  const parsed = parseReminderParts(rawDate);
  let startDate = parsed ? parsed.dateObj : null;
  if (!startDate) {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0, 0);
  }
  const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);
  const datesParam = formatCalendarUtc(startDate) + '/' + formatCalendarUtc(endDate);

  const leadName = lead.name ? String(lead.name).trim() : 'Prospecto';
  const rawReason = overrideReason !== undefined ? overrideReason : lead.reminderReason;
  const cleanReason = rawReason ? String(rawReason).trim() : '';
  const title = cleanReason ? cleanReason + ': ' + leadName : 'Seguimiento CRM: ' + leadName;

  const lines = [];
  if (cleanReason) {
    lines.push('Motivo: ' + cleanReason);
  }
  if (lead.phone) {
    lines.push('Teléfono: +' + lead.phone);
    lines.push('WhatsApp: https://wa.me/' + lead.phone);
  }
  if (lead.notes) {
    lines.push('Notas: ' + lead.notes);
  }
  const details = lines.join('\n');

  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' +
    encodeURIComponent(title) + '&dates=' + datesParam + '&details=' + encodeURIComponent(details);
}

export function openGoogleCalendar(lead, overrideReminderAt, overrideReason) {
  const url = buildGoogleCalendarUrl(lead, overrideReminderAt, overrideReason);
  if (isCapacitorNative()) {
    const plugins = window.Capacitor.Plugins;
    if (plugins && plugins.Browser && typeof plugins.Browser.open === 'function') {
      plugins.Browser.open({ url: url }).catch(() => {
        window.location.href = url;
      });
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return;
  }
  const popup = window.open(url, '_blank', 'noopener');
  if (!popup) {
    window.location.href = url;
  }
}

export async function scheduleNativeReminder(lead) {
  if (!isCapacitorNative()) {
    return false;
  }
  const plugins = window.Capacitor.Plugins;
  if (!plugins || !plugins.LocalNotifications) {
    return false;
  }
  const parsed = parseReminderParts(lead.reminderAt);
  if (!parsed || parsed.dateObj.getTime() <= Date.now()) {
    return false;
  }
  const notifId = hashLeadIdToInt(lead.id);
  const title = lead.reminderReason ? lead.reminderReason : 'Seguimiento CRM';
  const body = (lead.name ? lead.name : 'Prospecto') + ' (+' + (lead.phone ? lead.phone : '') + ')';
  try {
    await plugins.LocalNotifications.requestPermissions();
    await plugins.LocalNotifications.schedule({
      notifications: [{
        id: notifId,
        title: title,
        body: body,
        schedule: { at: parsed.dateObj },
        extra: { leadId: lead.id }
      }]
    });
    return true;
  } catch (error) {
    return false;
  }
}

export async function cancelNativeReminder(leadId) {
  if (!isCapacitorNative()) {
    return false;
  }
  const plugins = window.Capacitor.Plugins;
  if (!plugins || !plugins.LocalNotifications) {
    return false;
  }
  const notifId = hashLeadIdToInt(leadId);
  try {
    await plugins.LocalNotifications.cancel({ notifications: [{ id: notifId }] });
    return true;
  } catch (error) {
    return false;
  }
}
