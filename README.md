# Akın Var

Tarayıcıda Three.js ile çalışan, Total War esintili, tur tabanlı takım ordu savaşı. Savaş mantığı Throne of Curse'ten gelir. Tasarım: [docs/oyun-fikri.md](docs/oyun-fikri.md).

## Başlatma

`Baslat.cmd` dosyasına çift tıklayın ya da bu klasörde `npm start` çalıştırın, ardından http://localhost:5240 adresini açın. Node.js gerekir, npm kurulumu gerekmez (Three.js 0.180 `vendor/` içinde).

- `?asker=10000`: asker sayısı (en çok 20.000)
- `?golge=0`: gölgeler kapalı
- `?tohum=7`: savaş tohumu (aynı tohum aynı savaşı verir)

## Geliştirme

- `npm test`: simülasyon testleri
- `npm run olcum`: tarayıcısız simülasyon başarım ölçümü (2/5/10/20 bin asker)

## Durum

- **Faz 0 (başarım):** bölük düzeyi belirlenimci simülasyon, InstancedMesh çizim. RTX 5080'de 20.000 askerle 60 kare/sn.
- **Faz 1 (tek savaş, bota karşı):**
  - Çember arena, sis (bölükler yalnız çevresini görür), 30 sn sonra daralan alan (dışarıda kalan can kaybeder).
  - Seçim: tek tık, kutu, çift tık aynı tür, 1 / 2 türe göre, Ctrl A hepsi.
  - Emir: sağ tık yürü / saldır, Boşluk dur. Bot sisin içinde arar.
  - Ana ekran, Esc menüsü, maç sonu. F3 başarım paneli.

- **Faz 2 (tur döngüsü):**
  - Ana ekranda takım (1v1–5v5, boş koltuklar bot) ve bayrak canı (100 / 1.000 / 10.000 / 100.000).
  - Hazırlık (45 sn): tam ekran kart ızgarası. Ekonomi (400 × n, tur başı +150) ve aile başına talim (500 × n, +1 can) kalıcı; throneofcurse'ün 39 sınıfı 4 × 10 ızgarada, her tık bir bölük, sağ tık tam iade.
  - Savaş: throneofcurse üstünlük tablosu, arkadan vuruş +20, menzil, vuruş aralığı, atlı ve zırh hızı. Okçular ok atar.
  - Bayrak evresi (10 sn): kazananların sağ kalanları seçilen rakip bayrağa koşar, her biri bir can götürür; gönderilmeyen dağılır.
  - Bot kişilikleri: Açgözlü, Akıncı, Dengeli, Karşı kurucu.

- **Faz 3 (çevrim içi ve hazırlık arayüzü):**
  - josephuz oda standardı: ADIN, tek başına, ÇEVRİM İÇİ (hızlı katıl, oda kur, odaya katıl), açık odalar, bekleme odası (Mavi / Kırmızı koltuklar, takım, bayrak canı, bot zorluğu, açık / özel), davet linki ?oda=KOD, jetonla geri dönüş, kopanın yerine bot.
  - Maçı sunucu yürütür (20 Hz); istemci savaşı sunucunun adımları ve emirleriyle aynen koşar, 3 sn'de bir ikili anlıkla düzeltir.
  - Hazırlık: throneofcurse asker görselleri ve eşya ikonlu kartlar, en ucuz sol üstte, sınıf başına Geliştir, bilgi şeridi (malzeme, üstün / zayıf olduğu sınıflar).
  - Fiyatlar throneofcurse üretim tariflerinden (odun, demir, çelik, deri, yem).
  - Emirsiz bölükler botun yapay zekâsıyla savaşır; bot zorluğu Kolay / Orta / Zor.

Sunucuyu başlat: Unknown command: "start"


Did you mean one of these?
  npm star # Mark your favorite packages
  npm stars # View packages marked as favorites
  npm start # Start a package
To see a list of supported npm commands, run:
  npm help (çevrim içi odalar aynı portta, ws). Henüz Docker ve tunnel yok.


## Lisans / License

- **Kod:** [MIT](LICENSE), Copyright (c) 2026 JosephUz. Kodu kullanabilir, değiştirebilir, dağıtabilirsin.
- **MIT dışında, tüm hakları saklıdır:** "Akın Var" ve "JosephUz" adları, logo ve simgeler, `img/` altındaki asker görselleri ve eşya ikonları (Throne of Curse). Ayrıntı: [TRADEMARKS.md](TRADEMARKS.md).
- **Üçüncü taraf:** `vendor/` altındaki [three.js](https://github.com/mrdoob/three.js) MIT lisanslıdır (`vendor/THREE-LICENSE.txt`).

> **In English:** The code is licensed under [MIT](LICENSE). The names "Akın Var" and "JosephUz", the logo and icons are **not** covered by MIT and are all rights reserved; see [TRADEMARKS.md](TRADEMARKS.md). Forks must use a different name and logo.
