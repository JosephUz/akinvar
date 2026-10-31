// Oda kodu: 4 harf + '-' + 1 rakam (ör. KPRT-4). Karışan harfler (I, O, Q, W, X) ve rakamlar (0, 1) yok.
// Sunucu (server/odalar.mjs) ve istemci (main.js) aynı düzeltmeyi kullanır: büyük harf, tiresiz yazılana tire.
export const KOD_HARF = 'ABCDEFGHJKLMNPRSTUVYZ', KOD_RAKAM = '23456789';

/** Yeni kod; varMi(kod) doğruysa yeniden dener (benzersizlik). */
export function kodUret(varMi = () => false, r = Math.random) {
  let k;
  do k = Array.from({ length: 4 }, () => KOD_HARF[Math.floor(r() * KOD_HARF.length)]).join('') + '-' + KOD_RAKAM[Math.floor(r() * KOD_RAKAM.length)];
  while (varMi(k));
  return k;
}

/** Girilen kodu düzeltir: 'kprt4' / 'KPRT-4' / ' kprt 4 ' → 'KPRT-4'. Eski 4 harflik kod 'ABCD' olarak kalır (oda bulunmaz). */
export function kodDuzelt(s) {
  const t = String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return t.length > 4 ? t.slice(0, 4) + '-' + t.slice(4) : t;
}

/** Kodun harf kısmı 4 harf mi (değilse istemci "Oda kodunu yaz" der). */
export const kodYeterli = s => /^[A-Z]{4}/.test(kodDuzelt(s));
