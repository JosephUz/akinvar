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

**Faz 0 (başarım denemesi):** iki ordu karşı karşıya kendi kendine savaşır.
- Simülasyon bölük düzeyinde, belirlenimci.
- Çizim InstancedMesh ile.
- RTX 5080'de 20.000 askerle 60 kare/sn.
