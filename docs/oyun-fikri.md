# Akın Var — oyun fikri

> Durum: tasarım (2026-10-31). Kod yok. ✅ işaretli maddeler Yusuf'un onayladığı kararlar. ❓ işaretli maddeler hâlâ açık.

## Kaynaklar

- **Görsel referans:** Silvolt Studios, "30,000 troops – total war style game" (YouTube Shorts `ntiYxDjbCHI`). Kuşbakışı çayırda kare bloklar halinde binlerce asker, dizilişini koruyan birlikler, uzaklaşınca her köşede ayrı çatışma. Kareler: `C:\ju\paperclip\calisma\icerik\referans\ntiYxDjbCHI\`.
- **Oyun mantığı:** throneofcurse savaş modu (haklar Yusuf'ta).
  - `client/src/store/warStore.ts`, `client/src/components/war/War.tsx`
  - `shared/utils/combat.ts`, `combatCounter.ts`, `shared/constants/combat/*`
- **Altyapı:** Çayır Muhafızı / Kutu Hisar ile aynı. Three.js 0.180 izometrik görünüm, sunucu otoriter oda düzeni (`josephuz/docs/oda-standardi.md`), araç çubuğu standardı.

## Özet

Takım takım oynanan, tur tabanlı ordu savaşı. Her tur üç evreden oluşur:

1. **Hazırlık:** parayı ekonomiye, talime, askere ayırırsın ya da biriktirirsin.
2. **Savaş:** ordular çember arenaya dizilir, sis içinde birbirini arar, alan daralır, çarpışırlar.
3. **Bayrak:** kazanan takım sağ kalan askerlerini istediği rakip bayraklara gönderir. Her asker bir can götürür.

Bayrağı düşen oyuncu elenir. Bütün bayrakları düşen takım kaybeder.

## Oyuncular ✅

- **1v1'den 5v5'e kadar** iki takım.
- **Tek başına:** boş koltukları botlar doldurur, hem rakip hem takım arkadaşı olarak.
- **Çevrim içi:** arkadaşlarla oda kodu, en çok 5v5. Boş koltuk bottur, oyuncu düşerse koltuğu bot devralır.
- Botlar insanlarla aynı kurallarla oynar.

## Bayrak canı ✅

- Her oyuncunun kendi bayrağı vardır.
- Oda kurulurken can seçilir: **100** (varsayılan, kısa oyun) · 1.000 · 10.000 · 100.000.
- Bayrak canları her evrede ekranda görünür.
- Canı biten oyuncu elenir ve maçın geri kalanını izler. Bütün bayrakları düşen takım maçı kaybeder.

## Tur döngüsü

### 1. Hazırlık (45 sn) ✅

- Her oyuncuya tur başına **+1000** altın gelir. Üstüne ekonomi seviyesi kadar ek gelir eklenir.
- Biriktirmek serbesttir. Faiz yoktur.
- Süre bitince ya da herkes **Hazır** deyince savaş başlar. Kartlar kaybolur, arena görünür.

**Tam ekran kart ızgarası** ✅

Hazırlık ekranı alt bant değil, ekranı dolduran bir kart ızgarasıdır.

- **Kalıcı kart:** ızgaranın üstündeki şeritte, büyük **Ekonomi** kartı.
  - **Ekonomi:** seviye n'nin bedeli 400 × n, her seviye tur başına +150 altın getirir.
- **Asker kartları:** throneofcurse'teki 39 sınıfın hepsi kart olur, **4 satır × 10 sütun** ✅. Kalan 40. yuvada **Hazır** düğmesi durur.
  - Kartlar aileye göre dizilir: kılıçlı, mızraklı, okçu, atlı. Aile içinde soldan sağa malzeme ve güç artar.
  - Her ailenin başında küçük bir **Talim** düğmesi olur (aşağıya bak).
- **Bir tık bir bölük alır** ✅ (örneğin 20 asker; sayı denemede ayarlanır).
- Karta her tıkta:
  - kartın üstünden yukarı doğru **−500** gibi bir yazı çıkar ve kaybolur,
  - kartın köşesinde **adet rozeti** artar (×3 gibi).
  - Parası yetmeyen kart sönük görünür.
- **Sağ tık** bir adet geri alır ve parayı tam iade eder ✅. Bu yalnız hazırlıkta olur.
- Takım arkadaşlarının parası ve aldıkları görünür. Rakibinkiler görünmez.
- Ekranın üst köşesinde süre, altın ve bütün bayrak canları görünür.

### 2. Savaş ✅

- Ordular throneofcurse'teki gibi çember arenanın kenarına dizilir. Takım arkadaşları aynı yayda yan yana durur, rakip takım karşı yayda.
- **Sis:** her birim kendi görüş menzili kadarını görür. Takımın görüşü paylaşılır. Atlılar keşifte öne çıkar.
- **Daralan alan:** çember zamanla küçülür. Dışarıda kalan asker can kaybeder.
- **Süre sınırı yoktur** ✅. Alan en sonunda sıfıra iner, tur mutlaka biter. İki takım aynı anda yok olursa tur berabere sayılır, bayrak evresi olmaz.
- Savaşta yalnız askerler ölür. Ekonomi ve talim korunur.

**Komuta: throneofcurse savaşının bizim oyunlara uyarlanmış hali** ✅

- **Tek seçim:** askere tıkla.
- **Toplu seçim:** sürükleyip kutu çiz.
- **Aynı türü seç:** çift tıkla (ekrandaki aynı türden askerler; bu throneofcurse'te yok, yeni). Ayrıca 1–9 tuşları türe göre seçer.
- **Hepsini seç:** tek tuşla.
- **Emir:** sağ tık yere giderse yürü, düşmana giderse saldır.
- **Boşluk:** dur ve en yakınla çatış.
- **Dizilişle yürüt:** daire, kare, hilal, çift sıra.
- **Kamera:** WASD / kenar kaydırma, tekerlek yakınlaşma, F kendi ordun.
- Araç çubuğu ve Esc menüsü bizim standardımıza göre olur, F1 kontroller.
- Dokunmatik: sonra bakılacak ✅. Çayır'ın kahraman odaklı dokunmatik düzeni buraya uymaz.

### 3. Bayrak evresi (10 sn) ✅

- Savaş bitince kamera **yukarı çıkar ve uzaklaşır**. Bütün bayraklar ve kazanan takımın sağ kalan askerleri tek bakışta görünür. Herkes, kaybedenler ve elenenler dahil, olup biteni izler.
- Rakip bayrakların üstünde canları büyük yazıyla görünür.
- Kazanan takımın her oyuncusu **kendi askerlerini seçer** (savaştaki seçim kurallarıyla) ve **bir rakip bayrağa tıklar**. Askerler koşup bayrağa vurur:
  - her vuruşta bayrağın üstünden **−1** çıkar,
  - vuran asker haritadan kaybolur.
- Herkes istediği bayrağa yüklenebilir. Takım bir oyuncuya odaklanıp onu eleyebilir ya da hasarı dağıtıp birkaç oyuncuyu birden eleyebilir.
- **10 sn geri sayım.** Süre içinde bayrağa gönderilmeyen askerler dağılır, can götürmez. Bütün askerler harcanınca evre erken biter.
- Ölmüş bayrak seçilemez. Yoldayken hedefi ölen asker boşa gider ✅. Bu fazla yüklenmenin bedeli olur.
- Botlar hedefi kişiliğine göre seçer: Akıncı en düşük canı bitirmeye gider, Karşı kurucu en güçlü ekonomiyi hedefler.
- Askerler sonraki tura geçmez. Her tur ordu sıfırdan kurulur. Turdan tura yalnız ekonomi, talim ve birikmiş para taşınır.

## Asker canı ve talim ✅

- throneofcurse'teki gibi her vuruş **1 can** götürür. Vuruşun tutup tutmadığını isabet şansı belirler.
- Her asker **3 canla** başlar.
- **Talim** kalıcı bir yükseltmedir, ekonomi gibi turlar boyunca korunur. **Her asker ailesinin talimi ayrıdır** ✅ (kılıçlı, mızraklı, okçu, atlı). Her seviye o ailenin askerlerine **+1 can** verir.
  - throneofcurse'te en yüksek can 11'dir (yetenek 100 → 10 + 1 ustalık bonusu).
  - Öneri: talim 8 seviye olur (3 → 11 can).
  - Seviye bedeli: 500 × n ✅.

## Asker çeşitliliği ve dövüş (throneofcurse) ✅

- 39 sınıfın hepsi kart olur. Sınıf, donanımdan oluşan bir anahtardır: silah ve malzemesi, kalkan, binek, zırh (`sw:ir-sh:ir-fo-ch` gibi). Fiyat donanımdan hesaplanır.
- **Üstünlük tablosu** (`counterMatrix.json`): mızrak atlıyı, kılıç mızrağı yener…
- **Yön:** arkadan ve yandan vuruşa bonus. Savuşturma, zırh ve kalkan etkisi.
- **Hedefleme:** önce emir, sonra kilitli hedef, sonra menzildeki en yakın düşman.
- **Yeni:** moral ve bozgun. Kuşatılan ya da arkadan vurulan bölük dağılıp kaçabilir.

## Ölçek ve teknik ✅

- Simülasyon bölük düzeyinde yapılır: hareket, hedef, moral. Askerler bölük içinde kendi yuvasını izler.
- Çizimde Three.js `InstancedMesh` kullanılır. Hedef 5–10 bin asker. İlk adım: 2 bin askerle başarım (performans) denemesi.
- Çevrim içi kipte sunucu otoriterdir. Ağdan bölük düzeyinde durum gider.
- Tek başına kipte aynı simülasyon sunucusuz, tarayıcıda çalışır. Kutu Hisar gibi Worker'dan statik dağıtılır.

## Bot kişilikleri ✅

- **Açgözlü:** ilk turlarda ekonomiye yüklenir.
- **Akıncı:** erken asker basar, baskın yapar. Bayrak evresinde en zayıf bayrağı bitirir.
- **Dengeli:** ekonomi, talim ve asker arasında dengede kalır.
- **Karşı kurucu:** rakibin bir önceki turdaki ordusunun karşısını basar.

Zorluk ayarı kişilik karışımı ve karar kalitesiyle yapılır. Savaşta botlar throneofcurse'teki hedefleme yapay zekasını kullanır.

## Faz 3 sonrası değişenler (2026-10-31, Yusuf)

- **Talim → Geliştir, sınıf başına:** her kartın sağ üstünde ⬆ Geliştir; o sınıfın askerine +1 can (500 × n, en çok 8). Ayrı talim kartları kalktı.
- **Kart sırası:** fiyata göre, en ucuz sol üstte. Kartlarda throneofcurse asker görseli ve eşya ikonları; altta bilgi şeridi (malzeme, üstün / zayıf olduğu sınıflar).
- **Fiyat:** throneofcurse üretim tariflerinden ham madde (odun 1, demir 2, deri 1,5, yem 0,5) → 40 + 36 × değer^0,35, 10'a yuvarlı. Bir çelik bölüğü ~3 demir bölüğü fiyatına ve onları çoğunlukla yener.
- **Eşit şartlar:** emirsiz bölük, oyuncununki de, botun yapay zekâsıyla savaşır; emir alan bölük oyuncunun olur (Dur: yerinde bekler).
- **Bot zorluğu:** Kolay (paranın %70'i, karşı kurmaz) · Orta (%85) · Zor (hepsi).
- **Çevrim içi:** oda standardı; maçı sunucu yürütür, istemci aynı adımları koşar.

## Kapsam dışı ✅

- PvE dalga kipi (belki ileride).
- Askerlerin sonraki tura geçmesi ve turlar arası kıdem.
- Faiz.

## Açık sorular

Yok. Ayrıntılar fazlarda denenip ayarlanır.
