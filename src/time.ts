export function toLocalIso(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = fmt.formatToParts(d);
  const get = (type: string): string => {
    const found = parts.find((p) => p.type === type);
    return found ? found.value : '';
  };

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');

  const y = Number(year);
  const m = Number(month);
  const da = Number(day);
  const h = Number(hour) % 24;
  const mi = Number(minute);
  const s = Number(second);

  const asUtc = Date.UTC(y, m - 1, da, h, mi, s);
  const offsetMin = Math.round((asUtc - d.getTime()) / 60000);

  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${oh}:${om}`;
}

export function isoToMinutes(iso: string): number {
  return new Date(iso).getTime() / 60000;
}

export function parseDurationMinutes(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!m) return 0;
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = m[2] ? Number(m[2]) : 0;
  return hours * 60 + minutes;
}