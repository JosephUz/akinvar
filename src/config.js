// Akın Var — ortak sabitler. Simülasyon (sim.js) ve maç (match.js) tarayıcıdan bağımsızdır; sunucu da aynı dosyaları kullanır.

export const TICK = 1 / 20;            // simülasyon adımı (sn); çizim araya yumuşatır
export const BOLUK = { cols: 5, rows: 4 }; // bir bölük 20 asker
export const SPACING = 1.15;           // bölük içinde asker aralığı (atlı ve okçuda daha geniş)
export const BOLUK_GAP = 2.2;          // bölükler arası boşluk

export const SOLDIER = {
  hp: 3,                 // throneofcurse: her isabet 1 can; talim her seviyede +1
  radius: 0.36,          // birbirini itme yarıçapı
  walk: 2.1,             // bölüğün yürüyüşü (sınıf hızıyla çarpılır)
  run: 3.0,              // askerin yuvasına / hedefine koşusu
  acquire: 2.6,          // bölük çatışmada değilken düşmanı fark etme
  melee: 5.5,            // bölük çatışmadayken hedef arama
};
export const ARROW = { speed: 26, arc: 0.18, hitRadius: 1.6 };

export const ENGAGE = 7;      // iki yakın dövüş bölüğü bu kadar yaklaşınca çatışmaya girer
export const RETARGET = 1;    // bölük hedefini saniyede bir yeniler
export const AUTO_RANGE = 24; // emirsiz oyuncu bölüğü bu yakındaki görünen düşmana kendiliğinden saldırır
// Atlı okçu (vur-kaç): yakın dövüş bölüğü menzilin bu katından yakına gelince geri çekilir; alanın kenarına bu kadar yaklaşmaz.
export const SKIRMISH = { kite: 0.7, edge: 6 };
// Atlı hücumu: yakın dövüş atlısı çatışmaya girdiği an `time` sn boyunca mızraklı olmayanı `mult` kat isabetle vurur (tavan COMBAT.max).
// Çatışmadan en az `rearm` sn çıkmadan yeniden hücum edemez.
export const CHARGE = { time: 3, mult: 2, rearm: 3 };

// Daralan alan: bekleme, sonra sıfıra kadar düzgün daralma. Dışarıdaki asker belli aralıkla can kaybeder.
export const ZONE = { wait: 30, shrink: 150, damageEvery: 1.5 };

// Tur: hazırlık → savaş → bayrak evresi.
export const ECONOMY = { roundIncome: 1000, levelIncome: 150, costShare: 0.5 }; // bir üst seviyenin bedeli o seviyedeki tur gelirinin yarısı
export const TALIM = { share: 0.5, max: 8 };                                     // Geliştir: sınıf başına +1 can, bedeli tur gelirinin yarısı
export const PREP_TIME = 45;
export const FLAG_TIME = 20;
export const FLAG_HP = [100, 1000, 10000, 100000];
export const TEAM_SIZES = [1, 2, 3, 4, 5];

// Bot zorluğu: hazırlıkta paranın ne kadarını harcar, rakibin ordusunun karşısını kurar mı. Ad: zorluk.<anahtar>.
export const DIFFICULTY = {
  kolay: { spend: 0.7, counter: false },
  orta: { spend: 0.85, counter: true },
  zor: { spend: 1, counter: true },
};

// Takım adı: takim.0 (Mavi), takim.1 (Kırmızı)
export const TEAMS = [
  { color: '#4f7fc4', shades: ['#4f7fc4', '#3f9fb8', '#6a6fd0', '#3d8a9a', '#7f95d8'], selected: '#b9d8ff' },
  { color: '#c4523f', shades: ['#c4523f', '#c9783a', '#b23f63', '#a8553a', '#d06a5a'], selected: '#ffd0c4' },
];

// Bot kişilikleri (hazırlıkta harcama, bayrak evresinde hedef seçimi). Botun görünen adı kisilik.<key>.
export const PERSONALITIES = [
  { key: 'acgozlu' },
  { key: 'akinci' },
  { key: 'dengeli' },
  { key: 'karsi' },
];

// Çevrim içi sunucu: evdeki PC'de Docker + Cloudflare Tunnel (akinvar-sunucu.josephuz.com). Yerelde sayfa sunucudan açılınca aynı adres kullanılır.
export const SERVER = 'akinvar-sunucu.josephuz.com';
