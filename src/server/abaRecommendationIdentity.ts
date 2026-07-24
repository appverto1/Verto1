import crypto from 'crypto';
import {
  buildAbaRecommendationSemanticKey,
  type AbaClinicalRecommendation
} from '../utils/abaPlanningEngine';

export const ABA_RECOMMENDATION_IDENTITY_VERSION = 2;

export type ServerAbaRecommendationIdentity = {
  id: string;
  suggestionKey: string;
  semanticMaterial: string;
};

export function buildServerAbaRecommendationIdentity(
  recommendation: AbaClinicalRecommendation,
  authoritativeOrganizationId: string,
  authoritativePatientId: string
): ServerAbaRecommendationIdentity {
  const canonicalRecommendation = {
    ...recommendation,
    organization_id: authoritativeOrganizationId,
    patient_id: authoritativePatientId
  };
  const semanticMaterial = buildAbaRecommendationSemanticKey(canonicalRecommendation);
  const suggestionKey = crypto
    .createHash('sha256')
    .update(semanticMaterial, 'utf8')
    .digest('hex');

  return {
    id: `rec-sha256-${suggestionKey}`,
    suggestionKey,
    semanticMaterial
  };
}

export function applyServerAbaRecommendationIdentity(
  recommendation: AbaClinicalRecommendation,
  authoritativeOrganizationId: string,
  authoritativePatientId: string
): AbaClinicalRecommendation {
  const identity = buildServerAbaRecommendationIdentity(
    recommendation,
    authoritativeOrganizationId,
    authoritativePatientId
  );

  return {
    ...recommendation,
    id: identity.id,
    organization_id: authoritativeOrganizationId,
    patient_id: authoritativePatientId,
    suggestion_key: identity.suggestionKey,
    suggestion_key_version: ABA_RECOMMENDATION_IDENTITY_VERSION,
    evidence: {
      ...(recommendation.evidence || {}),
      suggestionKey: identity.semanticMaterial
    }
  };
}
