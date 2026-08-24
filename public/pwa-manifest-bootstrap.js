(() => {
  try {
    const hostname = String(window.location.hostname || '').trim().toLowerCase();
    const isStaging = hostname === 'api.appverto.com.br' || hostname.startsWith('staging.');
    const manifest = document.getElementById('verto-manifest');
    if (manifest) {
      manifest.setAttribute('href', isStaging ? '/manifest-staging.webmanifest' : '/manifest.webmanifest');
    }

    if (isStaging) {
      document.querySelector('meta[name="application-name"]')?.setAttribute('content', 'Verto Staging');
      document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Verto Staging');
      document.documentElement.dataset.vertoEnvironment = 'staging';
    } else {
      document.documentElement.dataset.vertoEnvironment = 'production';
    }
  } catch {
    // Production manifest remains the safe default declared in index.html.
  }
})();
