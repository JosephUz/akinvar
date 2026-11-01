// Akın Var — platform: dokunmatik mi, Android uygulamasının (Capacitor) içinde mi. Çayır Muhafızı'ndaki düzenin aynısı.

/** Gerçekten Capacitor uygulamasının içinde mi (taklit `?app` sayılmaz). */
export const isNative = () => !!window.Capacitor?.isNativePlatform?.();
/** Android uygulaması mı yoksa tarayıcı mı; `?app` ile tarayıcıda da uygulama kipi denenir (testler). */
export const isApp = () => isNative() || new URLSearchParams(location.search).has('app');
/** Dokunmatik ekran (telefon, tablet) ya da `?touch` ile zorlanmış dokunmatik kip. */
export const touchDevice = () => new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches;

/** Tarayıcıda oyuna girerken tam ekran ve yatay (yalnız dokunmatikte; uygulama zaten tam ekran ve yatay). */
export function enterFullscreen() {
  if (isNative() || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
    .catch(() => {});
}

/**
 * Android geri tuşu (Capacitor App eklentisi; paket bağımlılıklarda, `cap sync` yerel tarafı ekler). Paketleyici yok, @capacitor/core
 * yüklenmez: eklenti yerli köprünün `Capacitor.Plugins` nesnesinden alınır (registerPlugin köprüde yoktur, çağrılırsa açılış düşer).
 */
export function onBackButton(handler) {
  if (!isNative()) return;
  const App = window.Capacitor.Plugins?.App ?? window.Capacitor.registerPlugin?.('App');
  if (!App?.addListener) { console.warn('Capacitor App plugin missing: back button not bound'); return; }
  App.addListener('backButton', () => handler({ exit: () => App.exitApp() }));
}
