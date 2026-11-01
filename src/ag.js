// Çevrim içi bağlantı: tek WebSocket hem açık oda listesini hem bekleme odasını hem maçı taşır.
// Sunucu ikili çerçevelerle savaşın tam durumunu (anlık) yollar; bunlar { t: 'anlik', veri } olarak sıraya girer.
import { SERVER } from './config.js';
import { isApp } from './platform.js';

/** Sunucu adresi: sayfa sunucunun kendisinden açıldıysa (yerelde) aynı adres, yoksa config.js → SERVER. ?sunucu= ile değişir.
 * Android uygulamasında sayfa https://localhost'tan açılır ama sunucu orada değildir: hep SERVER. */
export function sunucuAdresi() {
  const p = new URLSearchParams(location.search).get('sunucu');
  if (p) return p;
  const h = location.hostname, kendi = !isApp() && (h === SERVER || h === 'localhost' || /^[\d.]+$|^\[/.test(h));
  return kendi ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}` : 'wss://' + SERVER;
}

/** olay(tur): 'acik' | 'kapali'. al() gelen mesajları sırayla verir. */
export function sunucuBaglanti(olay) {
  const kuyruk = []; let ws = null, acik = false, kapandi = false;
  try { ws = new WebSocket(sunucuAdresi()); ws.binaryType = 'arraybuffer'; }
  catch { setTimeout(() => olay('kapali')); return { gonder() {}, al: () => [], kapat() {}, get acik() { return false; } }; }
  ws.onopen = () => { acik = true; olay('acik'); };
  ws.onclose = ws.onerror = () => { if (kapandi) return; kapandi = true; acik = false; olay('kapali'); };
  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) { kuyruk.push({ t: 'anlik', veri: new Uint8Array(e.data) }); return; }
    try { kuyruk.push(JSON.parse(e.data)); } catch { /* bozuk */ }
  };
  return {
    get acik() { return acik; },
    gonder(m) { if (acik && ws.readyState === 1) ws.send(JSON.stringify(m)); },
    al: () => kuyruk.splice(0),
    kapat() { kapandi = true; try { ws.close(); } catch { /* yok */ } },
  };
}
