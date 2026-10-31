// Akın Var — ortak sabitler. Simülasyon (sim.js) tarayıcıdan bağımsızdır; sunucu da aynı dosyaları kullanır.

export const TICK = 1 / 20;            // simülasyon adımı (sn); çizim araya yumuşatır
export const BOLUK = { cols: 5, rows: 4 }; // bir bölük 20 asker
export const SPACING = 1.15;           // bölük içinde asker aralığı
export const BOLUK_GAP = 2.2;          // bölükler arası boşluk

export const SOLDIER = {
  hp: 3,                 // throneofcurse: her isabet 1 can
  radius: 0.36,          // birbirini itme yarıçapı
  walk: 2.1,             // bölüğün yürüyüşü
  run: 3.0,              // askerin yuvasına / hedefine koşusu
  reach: 0.95,           // yakın dövüş menzili
  cooldown: [0.9, 1.4],  // iki vuruş arası (sn)
  hitChance: 0.45,
  acquire: 2.6,          // bölük çatışmada değilken düşmanı fark etme
  melee: 5.5,            // bölük çatışmadayken hedef arama
};

export const ENGAGE = 7;     // iki bölük bu kadar yaklaşınca çatışmaya girer
export const RETARGET = 1;   // bölük hedefini saniyede bir yeniler

export const TEAMS = [
  { name: 'Mavi', color: '#4f7fc4' },
  { name: 'Kırmızı', color: '#c4523f' },
];

export const DEFAULT_SOLDIERS = 2000;
export const MAX_SOLDIERS = 20000;
