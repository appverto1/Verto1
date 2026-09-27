import type { Express } from 'express';
import { HELP_MEDIA_BUCKET, resolveHelpMedia } from '../src/help/helpManifest';

type Deps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: string) => any;
  currentClinicId: (user: any) => string | null;
};

export function registerHelpCenterRoutes(app: Express, deps: Deps) {
  const { supabase, noStoreDynamicResponse, checkAuth, requireClinicCapability, currentClinicId } = deps;
  app.get('/api/help/media/:mediaId', noStoreDynamicResponse, checkAuth, requireClinicCapability('clinic.view'), async (req: any, res: any) => {
    const clinicId = currentClinicId(req.session?.user);
    if (!clinicId) return res.status(403).json({ error: 'HELP_CLINIC_CONTEXT_REQUIRED' });
    const media = resolveHelpMedia(String(req.params.mediaId || ''));
    if (!media) return res.status(404).json({ error: 'HELP_MEDIA_NOT_FOUND' });
    if (media.classification === 'restricted_operational') return res.status(403).json({ error: 'HELP_MEDIA_RESTRICTED' });
    const { data, error } = await supabase.storage.from(HELP_MEDIA_BUCKET).createSignedUrl(media.objectKey, 60);
    if (error || !data?.signedUrl) return res.status(404).json({ error: 'HELP_MEDIA_UNAVAILABLE' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ mediaId: media.mediaId, mimeType: media.mimeType, url: data.signedUrl, expiresIn: 60 });
  });
}
