import type {CapabilityKey, ClinicBaseRole} from '../src/constants/authorizationModel';
import type {CapabilityOverrideLike} from '../src/utils/authorizationRuntime';
import type {OrganizationModuleKey, OrganizationModuleAccessMode} from '../src/constants/organizationModules';
import type {NewFeatureKey} from '../src/constants/featureMetadata';
type ResolvedClinicCapabilityContext = {
  membershipId: string;
  clinicId: string;
  userId: string;
  role: ClinicBaseRole;
  canSupervise: boolean;
  overrides: CapabilityOverrideLike[];
  capabilities: ReadonlySet<CapabilityKey>;
  modules: ReadonlySet<OrganizationModuleKey>;
  moduleAccessMode: OrganizationModuleAccessMode;
  entitlementVersion: number;
};

// GET /api/clinic/authorization/me
export function createClinicAuthorizationMeHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, getDefaultScopesForRole, resolveClinicCapabilityContext, sanitizeString, sendRouteDbError } = getDeps();

    try {
      const context = await resolveClinicCapabilityContext(req.session?.user);
      if (!context) {
        return res.status(403).json({
          success: false,
          error: 'CLINIC_AUTHORIZATION_CONTEXT_UNAVAILABLE',
          message: 'Não foi possível resolver seu vínculo ativo nesta clínica.'
        });
      }
      return res.json({
        success: true,
        data: {
          membershipId: context.membershipId,
          clinicId: context.clinicId,
          role: context.role,
          canSupervise: context.canSupervise,
          capabilities: Array.from(context.capabilities).sort(),
          modules: Array.from(context.modules).sort(),
          moduleAccessMode: context.moduleAccessMode,
          entitlementVersion: context.entitlementVersion,
          scopes: getDefaultScopesForRole(context.role, { canSupervise: context.canSupervise }),
          overrides: context.overrides.map((item: any) => ({
            permissionKey: sanitizeString(item?.permission_key || item?.permissionKey, 160),
            effect: sanitizeString(item?.effect, 20).toLowerCase()
          })).filter((item: any) => item.permissionKey && (item.effect === 'allow' || item.effect === 'deny'))
        }
      });
    } catch (error) {
      return sendRouteDbError(res, '/api/clinic/authorization/me [GET]', error, {
        clinicId: sanitizeString(currentClinicId(req.session?.user), 120),
        userId: sanitizeString(req.session?.user?.id, 120)
      });
    }

  };
}

// GET /api/user/feature-access
export function createUserFeatureAccessReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { canAccessTrackedNewFeature, isKnownNewFeatureKey, isUuid, resolveClinicCapabilityContext, sanitizeString, sendRouteDbError, supabase } = getDeps();

    try {
      const userId = sanitizeString(req.session?.user?.id, 120);
      if (!isUuid(userId)) {
        return res.status(401).json({ success: false, error: 'FEATURE_DISCOVERY_USER_INVALID' });
      }

      const requestedKeys = Array.from(new Set(
        sanitizeString(req.query?.keys, 1000)
          .split(',')
          .map((value) => value.trim())
          .filter(isKnownNewFeatureKey),
      )).slice(0, 20) as NewFeatureKey[];
      if (!requestedKeys.length) return res.json({ success: true, data: [] });

      const context = await resolveClinicCapabilityContext(req.session?.user);
      const allowedKeys = requestedKeys.filter((featureKey) => canAccessTrackedNewFeature(context, featureKey));
      if (!allowedKeys.length) return res.json({ success: true, data: [] });

      const { data, error } = await supabase
        .from('user_feature_access')
        .select('feature_key,first_accessed_at')
        .eq('user_id', userId)
        .in('feature_key', allowedKeys)
        .limit(20);
      if (error) throw error;

      return res.json({
        success: true,
        data: (Array.isArray(data) ? data : []).map((row: any) => ({
          feature_key: sanitizeString(row?.feature_key, 80),
          first_accessed_at: sanitizeString(row?.first_accessed_at, 80) || null,
        })),
      });
    } catch (error) {
      return sendRouteDbError(res, '/api/user/feature-access [GET]', error, {
        userId: sanitizeString(req.session?.user?.id, 120),
      });
    }

  };
}

// POST /api/user/feature-access/:featureKey
export function createUserFeatureAccessWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { canAccessTrackedNewFeature, isKnownNewFeatureKey, isUuid, resolveClinicCapabilityContext, sanitizeString, sendRouteDbError, supabase } = getDeps();

    try {
      const userId = sanitizeString(req.session?.user?.id, 120);
      const featureKeyRaw = sanitizeString(req.params?.featureKey, 80);
      if (!isUuid(userId)) {
        return res.status(401).json({ success: false, error: 'FEATURE_DISCOVERY_USER_INVALID' });
      }
      if (!isKnownNewFeatureKey(featureKeyRaw)) {
        return res.status(400).json({ success: false, error: 'FEATURE_DISCOVERY_KEY_INVALID' });
      }

      const context = await resolveClinicCapabilityContext(req.session?.user);
      if (!canAccessTrackedNewFeature(context, featureKeyRaw)) {
        return res.status(403).json({ success: false, error: 'FEATURE_DISCOVERY_ACCESS_DENIED' });
      }

      const { data, error } = await supabase.rpc('mark_user_feature_accessed_v1', {
        p_user_id: userId,
        p_feature_key: featureKeyRaw,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;

      return res.json({
        success: true,
        data: {
          feature_key: featureKeyRaw,
          first_accessed_at: sanitizeString((row as any)?.first_accessed_at, 80) || new Date().toISOString(),
        },
      });
    } catch (error) {
      return sendRouteDbError(res, '/api/user/feature-access/:featureKey [POST]', error, {
        userId: sanitizeString(req.session?.user?.id, 120),
        featureKey: sanitizeString(req.params?.featureKey, 80),
      });
    }

  };
}

// GET /api/clinic/authorization/capabilities/:permissionKey/members
export function createClinicCapabilityMembersReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { canDelegateClinicCapability, currentClinicId, isCapabilityKey, isClinicBaseRole, isDelegableCapability, isUuid, moduleAllowsCapability, resolveEffectiveClinicCapabilities, sanitizeEmail, sanitizeString, sendRouteDbError, supabase } = getDeps();

    try {
      const actorContext = req.authorizationContext as ResolvedClinicCapabilityContext;
      const permissionKey = sanitizeString(req.params?.permissionKey, 160);
      if (!isCapabilityKey(permissionKey) || !isDelegableCapability(permissionKey)) {
        return res.status(400).json({ success: false, error: 'CLINIC_PERMISSION_INVALID' });
      }
      if (!moduleAllowsCapability(actorContext.moduleAccessMode, actorContext.modules, permissionKey)) {
        return res.status(403).json({
          success: false,
          error: 'CLINIC_MODULE_NOT_ENTITLED',
          message: 'Este acesso pertence a um módulo não contratado pela clínica.'
        });
      }

      const { data: memberships, error: membershipError } = await supabase
        .from('clinic_memberships')
        .select('id,user_id,clinic_id,role,status,can_supervise,users:user_id(id,name,email)')
        .eq('clinic_id', actorContext.clinicId)
        .eq('status', 'active')
        .limit(500);
      if (membershipError) throw membershipError;

      const activeMemberships = (Array.isArray(memberships) ? memberships : []).filter((membership: any) => {
        const membershipId = sanitizeString(membership?.id, 120);
        const memberId = sanitizeString(membership?.user_id, 120);
        const role = sanitizeString(membership?.role, 40).toLowerCase();
        return isUuid(membershipId) && isUuid(memberId) && isClinicBaseRole(role);
      });
      const membershipIds = activeMemberships.map((membership: any) => sanitizeString(membership?.id, 120));
      const overrideByMembershipId = new Map<string, 'allow' | 'deny'>();
      if (membershipIds.length > 0) {
        const { data: overrideRows, error: overrideError } = await supabase
          .from('clinic_membership_permission_overrides')
          .select('membership_id,effect')
          .eq('permission_key', permissionKey)
          .in('membership_id', membershipIds)
          .limit(500);
        if (overrideError) throw overrideError;
        (overrideRows || []).forEach((row: any) => {
          const membershipId = sanitizeString(row?.membership_id, 120);
          const effect = sanitizeString(row?.effect, 20).toLowerCase();
          if (isUuid(membershipId) && (effect === 'allow' || effect === 'deny')) {
            overrideByMembershipId.set(membershipId, effect);
          }
        });
      }

      const members = activeMemberships.map((membership: any) => {
        const membershipId = sanitizeString(membership?.id, 120);
        const memberId = sanitizeString(membership?.user_id, 120);
        const role = sanitizeString(membership?.role, 40).toLowerCase() as ClinicBaseRole;
        const linkedUser = Array.isArray(membership?.users) ? membership.users[0] : membership?.users;
        const overrideEffect = overrideByMembershipId.get(membershipId) || null;
        const canSupervise = role === 'supervisor' || membership?.can_supervise === true;
        const baseline = resolveEffectiveClinicCapabilities(role, [], { canSupervise });
        const defaultEnabled = moduleAllowsCapability(actorContext.moduleAccessMode, actorContext.modules, permissionKey)
          && baseline?.capabilities.has(permissionKey) === true;
        const effective = resolveEffectiveClinicCapabilities(
          role,
          overrideEffect ? [{ permission_key: permissionKey, effect: overrideEffect }] : [],
          { canSupervise },
        );
        const effectiveEnabled = moduleAllowsCapability(actorContext.moduleAccessMode, actorContext.modules, permissionKey)
          && effective?.capabilities.has(permissionKey) === true;
        const canEnable = canDelegateClinicCapability({
          actorRole: actorContext.role,
          targetRole: role,
          actorUserId: actorContext.userId,
          targetUserId: memberId,
          capability: permissionKey,
          actorCapabilities: actorContext.capabilities,
          requestedEffect: 'allow',
        });
        const canDisable = canDelegateClinicCapability({
          actorRole: actorContext.role,
          targetRole: role,
          actorUserId: actorContext.userId,
          targetUserId: memberId,
          capability: permissionKey,
          actorCapabilities: actorContext.capabilities,
          requestedEffect: 'deny',
        });
        return {
          memberId,
          membershipId,
          name: sanitizeString(linkedUser?.name, 180) || null,
          email: sanitizeEmail(linkedUser?.email) || null,
          role,
          canSupervise,
          defaultEnabled,
          effectiveEnabled,
          overrideEffect,
          editable: canEnable || canDisable || Boolean(overrideEffect),
          canEnable,
          canDisable,
        };
      });

      return res.json({
        success: true,
        data: {
          permissionKey,
          members,
        },
      });
    } catch (error) {
      return sendRouteDbError(res, '/api/clinic/authorization/capabilities/:permissionKey/members [GET]', error, {
        permissionKey: sanitizeString(req.params?.permissionKey, 160),
        clinicId: sanitizeString(currentClinicId(req.session?.user), 120),
      });
    }

  };
}

// PATCH /api/clinic/authorization/capabilities/:permissionKey/members
export function createClinicCapabilityMembersWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { canDelegateClinicCapability, currentClinicId, enforcePayloadLimit, isCapabilityKey, isClinicBaseRole, isDelegableCapability, isMissingRelationError, isUuid, moduleAllowsCapability, roleHasDefaultCapability, sanitizeString, sanitizeTextField, sendRouteDbError, supabase } = getDeps();

    try {
      if (!enforcePayloadLimit(req, res, 32 * 1024, 'Permissões em lote')) return;
      const actorContext = req.authorizationContext as ResolvedClinicCapabilityContext;
      const permissionKey = sanitizeString(req.params?.permissionKey, 160);
      const requestedEffectRaw = req.body?.effect;
      const effect = requestedEffectRaw === null || requestedEffectRaw === undefined || requestedEffectRaw === ''
        ? null
        : sanitizeString(requestedEffectRaw, 20).toLowerCase();
      const reason = sanitizeTextField(req.body?.reason, 500) || null;
      const rawMemberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
      if (rawMemberIds.length < 1 || rawMemberIds.length > 100) {
        return res.status(400).json({ success: false, error: 'CLINIC_PERMISSION_MEMBERS_LIMIT' });
      }
      const normalizedMemberIds = rawMemberIds.map((value: any) => sanitizeString(value, 120));
      if (normalizedMemberIds.some((value: string) => !isUuid(value))) {
        return res.status(400).json({ success: false, error: 'CLINIC_PERMISSION_MEMBER_INVALID' });
      }
      const memberIds = Array.from(new Set(normalizedMemberIds)) as string[];

      if (!isCapabilityKey(permissionKey) || !isDelegableCapability(permissionKey)) {
        return res.status(400).json({ success: false, error: 'CLINIC_PERMISSION_INVALID' });
      }
      if (effect !== null && effect !== 'allow' && effect !== 'deny') {
        return res.status(400).json({ success: false, error: 'CLINIC_PERMISSION_EFFECT_INVALID' });
      }
      if (memberIds.length === 0) {
        return res.status(400).json({ success: false, error: 'CLINIC_PERMISSION_MEMBERS_REQUIRED' });
      }
      if (!moduleAllowsCapability(actorContext.moduleAccessMode, actorContext.modules, permissionKey)) {
        return res.status(403).json({
          success: false,
          error: 'CLINIC_MODULE_NOT_ENTITLED',
          message: 'Este acesso pertence a um módulo não contratado pela clínica.'
        });
      }

      const { data: memberships, error: membershipError } = await supabase
        .from('clinic_memberships')
        .select('id,user_id,clinic_id,role,status')
        .eq('clinic_id', actorContext.clinicId)
        .eq('status', 'active')
        .in('user_id', memberIds)
        .limit(100);
      if (membershipError) throw membershipError;
      const membershipRows = Array.isArray(memberships) ? memberships : [];
      const membershipByUserId = new Map(
        membershipRows.map((membership: any) => [sanitizeString(membership?.user_id, 120), membership]),
      );
      if (membershipByUserId.size !== memberIds.length) {
        return res.status(404).json({
          success: false,
          error: 'CLINIC_MEMBER_NOT_FOUND',
          message: 'Um ou mais profissionais não possuem vínculo ativo nesta clínica.'
        });
      }

      const validatedMemberships = memberIds.map((memberId) => {
        const membership: any = membershipByUserId.get(memberId);
        const membershipId = sanitizeString(membership?.id, 120);
        const membershipRole = sanitizeString(membership?.role, 40).toLowerCase();
        if (!isUuid(membershipId) || !isClinicBaseRole(membershipRole)) {
          throw Object.assign(new Error('CLINIC_MEMBER_NOT_FOUND'), { code: 'CLINIC_MEMBER_NOT_FOUND' });
        }
        if (!canDelegateClinicCapability({
          actorRole: actorContext.role,
          targetRole: membershipRole,
          actorUserId: actorContext.userId,
          targetUserId: memberId,
          capability: permissionKey,
          actorCapabilities: actorContext.capabilities,
          requestedEffect: effect,
        })) {
          throw Object.assign(new Error('CLINIC_PERMISSION_DELEGATION_DENIED'), {
            code: memberId === actorContext.userId ? 'SELF_PERMISSION_CHANGE_DENIED' : 'CLINIC_PERMISSION_DELEGATION_DENIED',
          });
        }
        return { membershipId, memberId, membershipRole };
      });

      const { error: rpcError } = await supabase.rpc('set_clinic_membership_permission_overrides_bulk_v1', {
        p_membership_ids: validatedMemberships.map((membership) => membership.membershipId),
        p_permission_key: permissionKey,
        p_effect: effect,
        p_actor_user_id: actorContext.userId,
        p_reason: reason,
      });
      if (rpcError) throw rpcError;

      return res.json({
        success: true,
        data: {
          permissionKey,
          effect,
          updatedCount: validatedMemberships.length,
          members: validatedMemberships.map((membership) => ({
            memberId: membership.memberId,
            membershipId: membership.membershipId,
            defaultEnabled: roleHasDefaultCapability(membership.membershipRole, permissionKey),
            effectiveEnabled: effect === 'allow'
              ? true
              : effect === 'deny'
                ? false
                : roleHasDefaultCapability(membership.membershipRole, permissionKey),
          })),
        },
      });
    } catch (error: any) {
      const errorCode = sanitizeString(error?.code, 80);
      if (errorCode === 'SELF_PERMISSION_CHANGE_DENIED' || errorCode === 'CLINIC_PERMISSION_DELEGATION_DENIED') {
        return res.status(403).json({
          success: false,
          error: errorCode,
          message: errorCode === 'SELF_PERMISSION_CHANGE_DENIED'
            ? 'Você não pode alterar as próprias permissões.'
            : 'Seu acesso atual não permite alterar um ou mais profissionais selecionados.'
        });
      }
      if (
        isMissingRelationError(error)
        || sanitizeString(error?.message, 300).includes('set_clinic_membership_permission_overrides_bulk_v1')
      ) {
        return res.status(503).json({
          success: false,
          error: 'CLINIC_PERMISSION_BULK_RPC_MIGRATION_REQUIRED',
          message: 'A função atômica de permissões em lote ainda não foi aplicada no banco.'
        });
      }
      return sendRouteDbError(res, '/api/clinic/authorization/capabilities/:permissionKey/members [PATCH]', error, {
        permissionKey: sanitizeString(req.params?.permissionKey, 160),
        clinicId: sanitizeString(currentClinicId(req.session?.user), 120),
      });
    }

  };
}

// GET /api/clinic/members/:memberId/authorization
export function createClinicMemberAuthorizationReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { CAPABILITY_CATALOG, canDelegateClinicCapability, canManageClinicRole, currentClinicId, getDefaultCapabilitiesForRole, getDefaultScopesForRole, isCapabilityKey, isClinicBaseRole, isUuid, moduleAllowsCapability, resolveEffectiveClinicCapabilities, sanitizeString, sendRouteDbError, supabase } = getDeps();

    try {
      const actorContext = req.authorizationContext as ResolvedClinicCapabilityContext;
      const memberId = sanitizeString(req.params?.memberId, 120);
      if (!isUuid(memberId)) {
        return res.status(400).json({ success: false, error: 'CLINIC_MEMBER_INVALID' });
      }
      if (memberId === actorContext.userId) {
        return res.status(403).json({
          success: false,
          error: 'SELF_PERMISSION_CHANGE_DENIED',
          message: 'Você não pode administrar as próprias permissões.'
        });
      }

      const { data: membership, error: membershipError } = await supabase
        .from('clinic_memberships')
        .select('id,user_id,clinic_id,role,status,can_supervise')
        .eq('user_id', memberId)
        .eq('clinic_id', actorContext.clinicId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      const membershipRole = sanitizeString(membership?.role, 40).toLowerCase();
      if (!membership || !isClinicBaseRole(membershipRole)) {
        return res.status(404).json({
          success: false,
          error: 'CLINIC_MEMBER_NOT_FOUND',
          message: 'Membro ativo não encontrado nesta clínica.'
        });
      }
      if (!canManageClinicRole(actorContext.role, membershipRole)) {
        return res.status(403).json({
          success: false,
          error: 'CLINIC_ROLE_TARGET_ABOVE_ACTOR',
          message: 'Seu papel atual não pode administrar este membro.'
        });
      }

      const { data: overrideRows, error: overrideError } = await supabase
        .from('clinic_membership_permission_overrides')
        .select('permission_key,effect,reason,updated_at')
        .eq('membership_id', sanitizeString(membership.id, 120))
        .limit(500);
      if (overrideError) throw overrideError;

      const overrides = Array.isArray(overrideRows) ? overrideRows : [];
      const canSupervise = membershipRole === 'supervisor' || membership?.can_supervise === true;
      const effective = resolveEffectiveClinicCapabilities(
        membershipRole,
        overrides,
        { canSupervise },
      );
      if (!effective) {
        return res.status(409).json({ success: false, error: 'CLINIC_MEMBER_AUTHORIZATION_INVALID' });
      }
      const defaults = getDefaultCapabilitiesForRole(membershipRole);
      const overrideMap = new Map(
        overrides
          .map((item: any) => [
            sanitizeString(item?.permission_key, 160),
            sanitizeString(item?.effect, 20).toLowerCase(),
          ] as const)
          .filter(([key, effect]) => isCapabilityKey(key) && (effect === 'allow' || effect === 'deny')),
      );

      return res.json({
        success: true,
        data: {
          membershipId: sanitizeString(membership.id, 120),
          memberId,
          role: membershipRole,
          canSupervise,
          scopes: getDefaultScopesForRole(membershipRole, { canSupervise }),
          catalog: CAPABILITY_CATALOG
            .filter((definition) => definition.delegable && moduleAllowsCapability(actorContext.moduleAccessMode, actorContext.modules, definition.key))
            .map((definition) => {
              const defaultEnabled = moduleAllowsCapability(actorContext.moduleAccessMode, actorContext.modules, definition.key) && defaults.has(definition.key);
              const overrideEffect = overrideMap.get(definition.key) || null;
              const canEnable = canDelegateClinicCapability({
                actorRole: actorContext.role,
                targetRole: membershipRole,
                actorUserId: actorContext.userId,
                targetUserId: memberId,
                capability: definition.key,
                actorCapabilities: actorContext.capabilities,
                requestedEffect: 'allow',
              });
              const canDisable = canDelegateClinicCapability({
                actorRole: actorContext.role,
                targetRole: membershipRole,
                actorUserId: actorContext.userId,
                targetUserId: memberId,
                capability: definition.key,
                actorCapabilities: actorContext.capabilities,
                requestedEffect: 'deny',
              });
              return {
                key: definition.key,
                label: definition.label,
                domain: definition.domain,
                sensitive: definition.sensitive === true,
                defaultEnabled,
                effectiveEnabled:
                  moduleAllowsCapability(actorContext.moduleAccessMode, actorContext.modules, definition.key) &&
                  effective.capabilities.has(definition.key),
                overrideEffect,
                editable: canEnable || canDisable || Boolean(overrideEffect),
                canEnable,
                canDisable,
                scopeLimited: !defaultEnabled && !canEnable,
              };
            }),
        }
      });
    } catch (error) {
      return sendRouteDbError(res, '/api/clinic/members/:memberId/authorization [GET]', error, {
        memberId: sanitizeString(req.params?.memberId, 120),
        clinicId: sanitizeString(currentClinicId(req.session?.user), 120),
      });
    }

  };
}

// PATCH /api/clinic/members/:memberId/authorization
export function createClinicMemberAuthorizationWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { canDelegateClinicCapability, currentClinicId, enforcePayloadLimit, isCapabilityKey, isClinicBaseRole, isDelegableCapability, isMissingRelationError, isUuid, moduleAllowsCapability, resolveEffectiveClinicCapabilities, sanitizeString, sanitizeTextField, sendRouteDbError, supabase } = getDeps();

    try {
      if (!enforcePayloadLimit(req, res, 8 * 1024, 'Permissão individual')) return;
      const actorContext = req.authorizationContext as ResolvedClinicCapabilityContext;
      const memberId = sanitizeString(req.params?.memberId, 120);
      const permissionKey = sanitizeString(req.body?.permissionKey || req.body?.permission_key, 160);
      const requestedEffectRaw = req.body?.effect;
      const effect = requestedEffectRaw === null || requestedEffectRaw === undefined || requestedEffectRaw === ''
        ? null
        : sanitizeString(requestedEffectRaw, 20).toLowerCase();
      const reason = sanitizeTextField(req.body?.reason, 500) || null;

      if (!isUuid(memberId) || !isCapabilityKey(permissionKey)) {
        return res.status(400).json({ success: false, error: 'CLINIC_PERMISSION_INVALID' });
      }
      if (effect !== null && effect !== 'allow' && effect !== 'deny') {
        return res.status(400).json({ success: false, error: 'CLINIC_PERMISSION_EFFECT_INVALID' });
      }
      if (!isDelegableCapability(permissionKey)) {
        return res.status(403).json({
          success: false,
          error: 'CLINIC_PERMISSION_NOT_DELEGABLE',
          message: 'Esta permissão é estrutural e não pode ser delegada.'
        });
      }
      if (!moduleAllowsCapability(actorContext.moduleAccessMode, actorContext.modules, permissionKey)) {
        return res.status(403).json({
          success: false,
          error: 'CLINIC_MODULE_NOT_ENTITLED',
          message: 'Este acesso pertence a um módulo não contratado pela clínica.'
        });
      }

      const { data: membership, error: membershipError } = await supabase
        .from('clinic_memberships')
        .select('id,user_id,clinic_id,role,status,can_supervise')
        .eq('user_id', memberId)
        .eq('clinic_id', actorContext.clinicId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      const membershipRole = sanitizeString(membership?.role, 40).toLowerCase();
      const membershipId = sanitizeString(membership?.id, 120);
      if (!membership || !isUuid(membershipId) || !isClinicBaseRole(membershipRole)) {
        return res.status(404).json({ success: false, error: 'CLINIC_MEMBER_NOT_FOUND' });
      }
      if (!canDelegateClinicCapability({
        actorRole: actorContext.role,
        targetRole: membershipRole,
        actorUserId: actorContext.userId,
        targetUserId: memberId,
        capability: permissionKey,
        actorCapabilities: actorContext.capabilities,
        requestedEffect: effect,
      })) {
        const selfEdit = memberId === actorContext.userId;
        return res.status(403).json({
          success: false,
          error: selfEdit ? 'SELF_PERMISSION_CHANGE_DENIED' : 'CLINIC_PERMISSION_DELEGATION_DENIED',
          message: selfEdit
            ? 'Você não pode alterar as próprias permissões.'
            : 'Seu acesso atual não permite delegar esta permissão para este membro.'
        });
      }

      const { error: rpcError } = await supabase.rpc('set_clinic_membership_permission_override_v1', {
        p_membership_id: membershipId,
        p_permission_key: permissionKey,
        p_effect: effect,
        p_actor_user_id: actorContext.userId,
        p_reason: reason,
      });
      if (rpcError) throw rpcError;

      const { data: refreshedRows, error: refreshedError } = await supabase
        .from('clinic_membership_permission_overrides')
        .select('permission_key,effect')
        .eq('membership_id', membershipId)
        .limit(500);
      if (refreshedError) throw refreshedError;
      const effective = resolveEffectiveClinicCapabilities(
        membershipRole,
        refreshedRows || [],
        { canSupervise: membershipRole === 'supervisor' || membership?.can_supervise === true },
      );
      const baseline = resolveEffectiveClinicCapabilities(
        membershipRole,
        [],
        { canSupervise: membershipRole === 'supervisor' || membership?.can_supervise === true },
      );
      return res.json({
        success: true,
        data: {
          memberId,
          membershipId,
          permissionKey,
          effect,
          defaultEnabled: baseline?.capabilities.has(permissionKey) === true,
          effectiveEnabled: effective?.capabilities.has(permissionKey) === true,
        }
      });
    } catch (error: any) {
      if (isMissingRelationError(error) || sanitizeString(error?.message, 300).includes('set_clinic_membership_permission_override_v1')) {
        return res.status(503).json({
          success: false,
          error: 'CLINIC_PERMISSION_RPC_MIGRATION_REQUIRED',
          message: 'A função atômica de permissões ainda não foi aplicada no banco.'
        });
      }
      return sendRouteDbError(res, '/api/clinic/members/:memberId/authorization [PATCH]', error, {
        memberId: sanitizeString(req.params?.memberId, 120),
        clinicId: sanitizeString(currentClinicId(req.session?.user), 120),
      });
    }

  };
}

// GET /api/clinic/members
export function createClinicMembersReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { asSafeNumber, buildDefaultProfessionalWorkingSchedule, buildProfessionalProfilePhotoViewUrl, currentClinicId, extractPatientPhotosStoragePath, formatClinicAccessRoleLabel, logRouteDbError, normalizeClinicalSpecialty, readProfessionalTitleFromSource, readProfessionalWorkingScheduleFromMetadata, resolveProfessionalProfileSpecialty, sanitizeProfessionalWorkingSchedule, sanitizeSessionUrl, sanitizeString, supabase } = getDeps();

    const user = req.session.user;

    try {
      const clinicId = currentClinicId(user);
      const { data, error } = await supabase
        .from('clinic_memberships')
        .select(`
          user_id,
          role,
          status,
          created_at,
          specialty,
          can_supervise,
          work_schedule,
          availability_timezone,
          work_schedule_configured_at,
          users:user_id (
            id,
            name,
            email,
            profile_picture
          )
        `)
        .eq('clinic_id', clinicId)
        .eq('status', 'active');

      if (error) throw error;

      const memberIds = Array.from(
        new Set(
          (data || [])
            .map((member: any) => sanitizeString(member?.users?.id || member?.user_id, 120))
            .filter(Boolean),
        ),
      );
      const professionalProfilesByUserId = new Map<string, any>();
      if (memberIds.length > 0) {
        const { data: professionalProfiles } = await supabase
          .from('professional_profiles')
          .select('user_id, full_name, specialty, profile_photo_url, metadata')
          .in('user_id', memberIds);

        (professionalProfiles || []).forEach((profile: any) => {
          const userId = sanitizeString(profile?.user_id, 120);
          if (userId) professionalProfilesByUserId.set(userId, profile);
        });
      }

      const members = (data || []).map((m: any) => {
        const memberId = sanitizeString(m.users?.id || m.user_id, 120);
        const profile = professionalProfilesByUserId.get(memberId) || {};
        const metadata = profile?.metadata && typeof profile.metadata === 'object' ? profile.metadata : {};
        const profilePicturePath =
          extractPatientPhotosStoragePath(metadata?.profilePicturePath) ||
          extractPatientPhotosStoragePath(metadata?.profile_picture_path) ||
          extractPatientPhotosStoragePath(profile?.profile_photo_url) ||
          extractPatientPhotosStoragePath(m?.users?.profile_picture);
        const profilePicture = profilePicturePath
          ? buildProfessionalProfilePhotoViewUrl(profilePicturePath, clinicId, memberId)
          : sanitizeSessionUrl(profile?.profile_photo_url || m?.users?.profile_picture);
        const membershipSchedule = m?.work_schedule && typeof m.work_schedule === 'object'
          ? sanitizeProfessionalWorkingSchedule(m.work_schedule, 50)
          : null;
        const fallbackDuration = asSafeNumber(
          membershipSchedule?.defaultSessionDurationMinutes ?? metadata?.sessionDurationMinutes ?? metadata?.defaultSessionDurationMinutes,
          15,
          360
        ) || 50;
        const legacySchedule = readProfessionalWorkingScheduleFromMetadata(metadata, fallbackDuration);
        const specialty = normalizeClinicalSpecialty(m?.specialty) || resolveProfessionalProfileSpecialty(profile) || null;
        const professionalTitle = ['therapist', 'supervisor', 'coordinator', 'director'].includes(String(m.role || '').toLowerCase()) && specialty
          ? specialty || readProfessionalTitleFromSource({ metadata }) || null
          : null;
        const canSupervise = m.role === 'supervisor' || m?.can_supervise === true;
        return {
          id: m.users?.id || m.user_id,
          name:
            sanitizeString(profile?.full_name, 180) ||
            m.users?.name ||
            'Profissional',
          full_name:
            sanitizeString(profile?.full_name, 180) ||
            m.users?.name ||
            'Profissional',
          email: m.users?.email || '',
          role: m.role,
          canSupervise,
          can_supervise: canSupervise,
          status: m.status,
          specialty,
          professionalTitle,
          profileRole: professionalTitle,
          roleLabel: formatClinicAccessRoleLabel(m.role, { professionalTitle, canSupervise }),
          profilePicture: profilePicture || null,
          profile_picture: profilePicture || null,
          profilePhotoUrl: profilePicture || null,
          profile_photo_url: profilePicture || null,
          profilePicturePath: profilePicturePath || null,
          profile_picture_path: profilePicturePath || null,
          workSchedule: membershipSchedule || legacySchedule || buildDefaultProfessionalWorkingSchedule(fallbackDuration),
          workScheduleConfigured: Boolean(membershipSchedule || legacySchedule),
          workScheduleScope: membershipSchedule ? 'clinic_membership' : legacySchedule ? 'legacy_global' : 'default',
          availabilityTimezone: sanitizeString(m?.availability_timezone, 80) || 'America/Sao_Paulo',
          clinic_id: clinicId,
          created_at: m.created_at
        };
      });
      res.json({ success: true, data: members });
    } catch (error: any) {
      logRouteDbError('/api/clinic/members [GET]', error, { clinicId: sanitizeString(currentClinicId(req.session?.user), 120) });
      res.status(500).json({ error: 'Falha na operação de dados.' });
    }

  };
}

// PATCH /api/clinic/members/:memberId/supervision-eligibility
export function createClinicSupervisionEligibilityWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, enforcePayloadLimit, isUuid, sanitizeString, sendRouteDbError, supabase } = getDeps();

    if (!enforcePayloadLimit(req, res, 2 * 1024, 'Elegibilidade de supervisão')) return;
    const actor = req.session.user;
    const memberId = sanitizeString(req.params?.memberId, 120);
    const clinicId = sanitizeString(currentClinicId(actor), 120);
    const actorId = sanitizeString(actor?.id, 120);
    if (!isUuid(memberId) || !isUuid(clinicId) || !isUuid(actorId) || typeof req.body?.canSupervise !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'SUPERVISION_ELIGIBILITY_INVALID',
        message: 'Informe um profissional válido e o estado de supervisão.'
      });
    }

    try {
      const { data, error } = await supabase.rpc('set_clinic_member_supervision_eligibility_v1', {
        p_clinic_id: clinicId,
        p_member_id: memberId,
        p_actor_id: actorId,
        p_can_supervise: req.body.canSupervise,
      });
      if (error) {
        const message = sanitizeString(error?.message || String(error), 300);
        if (message.includes('SUPERVISION_ELIGIBILITY_MEMBER_NOT_FOUND')) {
          return res.status(404).json({ success: false, error: 'SUPERVISION_ELIGIBILITY_MEMBER_NOT_FOUND' });
        }
        if (message.includes('SUPERVISION_ELIGIBILITY_PROFESSIONAL_REQUIRED')) {
          return res.status(422).json({
            success: false,
            error: 'SUPERVISION_ELIGIBILITY_PROFESSIONAL_REQUIRED',
            message: 'Somente um Profissional pode ser habilitado para supervisão.'
          });
        }
        if (message.includes('SUPERVISION_ELIGIBILITY_SPECIALTY_REQUIRED')) {
          return res.status(422).json({
            success: false,
            error: 'SUPERVISION_ELIGIBILITY_SPECIALTY_REQUIRED',
            message: 'Cadastre a especialidade clínica antes de habilitar supervisão.'
          });
        }
        if (
          message.includes('set_clinic_member_supervision_eligibility_v1')
          || sanitizeString((error as any)?.code, 40) === 'PGRST202'
          || sanitizeString((error as any)?.code, 40) === '42883'
        ) {
          return res.status(503).json({
            success: false,
            error: 'SUPERVISION_CAPABILITY_MIGRATION_REQUIRED',
            message: 'A migração de supervisão profissional ainda não foi aplicada no banco.'
          });
        }
        throw error;
      }

      const row = Array.isArray(data) ? data[0] : data;
      return res.json({
        success: true,
        data: {
          memberId,
          canSupervise: req.body.canSupervise,
          endedSupervisionAssignments: Math.max(0, Number(row?.ended_supervision_assignments) || 0),
        },
        message: req.body.canSupervise
          ? 'Profissional habilitado para receber vínculos de supervisão.'
          : 'Supervisão removida. Vínculos ativos de supervisão foram encerrados com segurança.'
      });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/clinic/members/:memberId/supervision-eligibility [PATCH]', error, {
        memberId,
        clinicId,
        actorId,
      });
    }

  };
}
