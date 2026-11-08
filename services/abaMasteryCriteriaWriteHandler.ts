// Compare jsonb criteria irrespective of object-key ordering; never emit a success without returning the stored field.
const canonicalMasteryCriteriaJson = (value: any): string =>
  JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
      : entry
  );

// ABA-M09: literal extraction of mastery-criteria PATCH. No calculation, storage or authorization semantics changed.
// Auth, patient access and clinic capability middleware stay in server.ts in their original order.
// Dependency injection is lazy to preserve request-time initialization and avoid circular imports.
export function createAbaMasteryCriteriaWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, ABA_TARGET_RECOMMENDATION_SELECT, applyAbaTenantScope, hasMissingFinancialSchema, isMissingRelationError, buildAbaMasteryCriteriaUpdatePayload, updateAbaTargetWithSchemaFallback, persistActivityLog, formatAbaMasteryCriterion, normalizeAbaMasteryCriterion, abaMasteryCriterionSourceLabel, sendRouteDbError } = getDeps();
    try {
      const patientId = sanitizeString(req.params.patientId || req.body?.patient_id || req.body?.patientId, 120);
      const targetId = sanitizeString(req.params.targetId || req.body?.target_id || req.body?.targetId, 180);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      if (!isUuid(patientId) || !isUuid(targetId) || !clinicId) {
        return res.status(400).json({ success: false, error: 'Dados invalidos para editar o criterio.' });
      }

      let targetQuery = supabase
        .from('aba_targets')
        .select(ABA_TARGET_RECOMMENDATION_SELECT)
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .eq('id', targetId)
        .limit(1);
      targetQuery = applyAbaTenantScope(targetQuery, req.session.user, clinicId, organizationId);
      const targetResult = await targetQuery.maybeSingle();
      if (targetResult.error) {
        if (hasMissingFinancialSchema(targetResult.error) || isMissingRelationError(targetResult.error)) {
          return res.status(503).json({ success: false, error: 'Schema ABA ainda nao aplicado.' });
        }
        throw targetResult.error;
      }
      const target = targetResult.data;
      if (!target?.id) return res.status(404).json({ success: false, error: 'Habilidade nao encontrada para este paciente.' });

      const previousCriteria = target?.mastery_criteria && typeof target.mastery_criteria === 'object' ? target.mastery_criteria : null;
      const built = buildAbaMasteryCriteriaUpdatePayload(req.body, actorId);
      if (built.error || !built.criteria || !built.normalized) {
        return res.status(400).json({ success: false, error: built.error || 'Criterio invalido.' });
      }

      const update = await updateAbaTargetWithSchemaFallback(
        targetId,
        {
          mastery_criteria: built.criteria,
          updated_at: new Date().toISOString()
        },
        clinicId,
        organizationId,
        patientId,
        'mastery_criteria'
      );
      if (update.error) {
        if (hasMissingFinancialSchema(update.error) || isMissingRelationError(update.error)) {
          return res.status(503).json({ success: false, error: 'Schema ABA ainda nao aplicado.' });
        }
        throw update.error;
      }

      const persistedCriteria = update.data?.mastery_criteria;
      if (
        update.data?.id !== targetId ||
        !persistedCriteria ||
        canonicalMasteryCriteriaJson(persistedCriteria) !== canonicalMasteryCriteriaJson(built.criteria)
      ) {
        return res.status(409).json({
          success: false,
          error: 'MASTERY_CRITERIA_NOT_PERSISTED',
          message: 'A gravação do critério não foi confirmada. Tente novamente.'
        });
      }

      void persistActivityLog({
        userId: actorId || '',
        clinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email, 180) || 'Equipe',
        title: 'Criterio de maestria atualizado',
        content: `Criterio da habilidade "${sanitizeString(target?.name, 180) || 'habilidade'}" atualizado.`,
        type: 'clinical',
        actionType: 'MASTERY_CRITERIA_UPDATED',
        payload: {
          targetName: sanitizeString(target?.name, 180) || null,
          previousCriterion: previousCriteria ? formatAbaMasteryCriterion(normalizeAbaMasteryCriterion(previousCriteria)) : 'Criterio nao configurado',
          newCriterion: formatAbaMasteryCriterion(built.normalized),
          source: 'skill'
        }
      });

      return res.json({
        success: true,
        message: 'Criterio de maestria atualizado.',
        data: {
          criteria: built.criteria,
          criterionLabel: formatAbaMasteryCriterion(built.normalized),
          criterionSourceLabel: abaMasteryCriterionSourceLabel(built.normalized)
        }
      });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/targets/:targetId/mastery-criteria [PATCH]', error, {
        fallbackMessage: 'Nao foi possivel editar o criterio agora.'
      });
    }
  };
}
