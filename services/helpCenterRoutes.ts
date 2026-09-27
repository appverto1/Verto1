import type { Express } from 'express';
import { HELP_MEDIA_BUCKET, publishedHelpProjection, resolveHelpMedia } from '../src/help/helpManifest';

type Deps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: string) => any;
  currentClinicId: (user: any) => string | null;
  projectArticles?: typeof publishedHelpProjection;
  resolveMedia?: typeof resolveHelpMedia;
};

const setValues = (value:any): string[] => value instanceof Set ? Array.from(value).map(String) : Array.isArray(value) ? value.map(String) : [];
const currentClinicName = (user:any, clinicId:string) => {
  const active=user?.activeAccessContext;
  const activeId=String(active?.clinicId||active?.clinic_id||user?.clinicId||'').trim();
  if(activeId!==clinicId) return '';
  return String(active?.clinicName||active?.clinic_name||user?.clinicName||user?.workspaceName||'').trim();
};

export function registerHelpCenterRoutes(app: Express, deps: Deps) {
  const { supabase, noStoreDynamicResponse, checkAuth, requireClinicCapability, currentClinicId } = deps;
  const projectArticles = deps.projectArticles || publishedHelpProjection;
  const resolveMedia = deps.resolveMedia || resolveHelpMedia;
  const helpContext = (req:any) => {
    const user=req.session?.user;
    const clinicId = currentClinicId(user);
    const context = req.authorizationContext;
    const audience = String(context?.role || user?.role || '').trim().toLowerCase();
    const capabilities = setValues(context?.capabilities);
    const modules = setValues(context?.modules);
    return { clinicId, clinicName: clinicId?currentClinicName(user,clinicId):'', audience, capabilities, modules };
  };

  app.get('/api/help/catalog', noStoreDynamicResponse, checkAuth, requireClinicCapability('clinic.view'), async (req: any, res: any) => {
    const { clinicId, clinicName, audience, capabilities, modules } = helpContext(req);
    if (!clinicId) return res.status(403).json({ error: 'HELP_CLINIC_CONTEXT_REQUIRED' });
    const articles = projectArticles(audience, capabilities, modules);
    return res.json({ clinicId, clinicName: clinicName||null, articles });
  });

  app.get('/api/help/media/:mediaId', noStoreDynamicResponse, checkAuth, requireClinicCapability('clinic.view'), async (req: any, res: any) => {
    const { clinicId, audience, capabilities, modules } = helpContext(req);
    if (!clinicId) return res.status(403).json({ error: 'HELP_CLINIC_CONTEXT_REQUIRED' });
    const mediaId = String(req.params.mediaId || '');
    const media = resolveMedia(mediaId);
    if (!media) return res.status(404).json({ error: 'HELP_MEDIA_NOT_FOUND' });
    const authorizedArticle = projectArticles(audience, capabilities, modules).find(article => article.mediaIds.includes(mediaId));
    if (!authorizedArticle) return res.status(404).json({ error: 'HELP_MEDIA_NOT_FOUND' });
    const { data, error } = await supabase.storage.from(HELP_MEDIA_BUCKET).createSignedUrl(media.objectKey, 60);
    if (error || !data?.signedUrl) return res.status(404).json({ error: 'HELP_MEDIA_UNAVAILABLE' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ mediaId: media.mediaId, mimeType: media.mimeType, url: data.signedUrl, expiresIn: 60, supportsRange: media.mimeType.startsWith('video/') });
  });
}
