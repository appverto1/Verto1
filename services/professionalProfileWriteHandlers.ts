// Surgical extraction: preserve route ordering, authorization middleware, database writes and responses.
type AppRole = 'owner' | 'admin' | 'director' | 'coordinator' | 'supervisor' | 'receptionist' | 'therapist' | 'biller' | 'patient';
export function createProfessionalOnboardingCompletionHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { resolveOnboardingContextForUser, sanitizeString, sanitizeEmail, isProfessionalLegalSession, ensureProfessionalTermsAccepted, supabase, logRouteDbError, sanitizeDate, asSafeNumber, sanitizePhone, normalizeCpf, sanitizeUrl, normalizeClinicalSpecialty, isProfessionalIdentifierInputValid, sanitizeProfessionalIdentifier, sanitizeProfessionalWorkingSchedule, normalizeClinicAccessStatus, CLINIC_ACCESS_ACTIVE_STATUSES, ACTIVE_PATIENT_BILLING_MODEL, assertNoOtherWorkspaceScheduleOverlap, cleanObject, extractMissingColumnName, fetchProfessionalProfileWithSchemaFallback, isMissingRelationError, currentClinicTimeZone, mergeAuthoritativeClinicSettings, hydrateSessionUserWithOnboardingContext, buildPatientPhotoViewUrl, extractPatientPhotosStoragePath, sanitizeSessionUrl, compactWorkspacesForSession, fetchUserWorkspaces } = getDeps();
    const { userId } = req.params;

    if (req.session.user.id !== userId) {
      return res.status(401).json({ error: 'Unauthorized - ID mismatch' });
    }

    try {
      const context = await resolveOnboardingContextForUser({
        userId: sanitizeString(userId, 120),
        email: sanitizeEmail(req.session.user?.email),
        preferredClinicId: req.session.user?.activeWorkspaceId || req.session.user?.clinicId,
        role: req.session.user?.role,
      });
      if (context.onboardingMode === 'invalid' || !context.clinic?.id) {
        return res.status(409).json({
          success: false,
          code: context.errorCode || 'ONBOARDING_CLINIC_NOT_FOUND',
          error: 'Não foi possível identificar a clínica vinculada ao seu convite. Fale com o responsável da clínica.'
        });
      }

      const role = (context.membership?.role || req.session.user.role) as AppRole;
      const clinicId = context.clinic.id;
      const isClinicManagedMember = ['invited_professional', 'clinic_member'].includes(context.onboardingMode);
      if (isClinicManagedMember && !context.membership) {
        return res.status(409).json({
          success: false,
          code: 'ONBOARDING_MEMBERSHIP_REQUIRED',
          error: 'Seu convite ainda não concluiu o vínculo com a clínica. Abra novamente o link recebido por e-mail.'
        });
      }
      if (!isProfessionalLegalSession({ id: userId, role })) {
        return res.status(403).json({ error: 'PROFESSIONAL_PORTAL_REQUIRED' });
      }
      try {
        const termsAccepted = await ensureProfessionalTermsAccepted({
          supabase,
          userId,
          explicitlyAccepted: req.body?.acceptProfessionalTerms === true,
          contextKey: 'professional-onboarding',
        });
        if (!termsAccepted) {
          return res.status(428).json({
            success: false,
            error: 'PROFESSIONAL_TERMS_REQUIRED',
            message: 'Confirme os Termos de Uso para concluir o cadastro profissional.',
          });
        }
      } catch (termsError: any) {
        logRouteDbError('/api/profile/complete-onboarding [LEGAL_ACCEPTANCE]', termsError, { userId });
        return res.status(503).json({ success: false, error: 'LEGAL_ACCEPTANCE_STATE_UNAVAILABLE' });
      }
      const fullName = sanitizeString(req.body?.fullName || req.body?.name, 180);
      const birthDate = sanitizeDate(req.body?.birthDate);
      const gender = sanitizeString(req.body?.gender, 40);
      const cep = sanitizeString(req.body?.cep || req.body?.addressPostalCode || req.body?.postalCode, 20);
      const logradouro = sanitizeString(req.body?.logradouro || req.body?.addressLine || req.body?.street, 180);
      const number = sanitizeString(req.body?.number || req.body?.addressNumber, 20);
      const complement = sanitizeString(req.body?.complement || req.body?.addressComplement, 120);
      const bairro = sanitizeString(req.body?.bairro || req.body?.addressDistrict || req.body?.district, 120);
      const cidade = sanitizeString(req.body?.cidade || req.body?.addressCity || req.body?.city, 120);
      const uf = sanitizeString(req.body?.uf || req.body?.state || req.body?.addressState, 2).toUpperCase();
      const sessionDurationMinutes = asSafeNumber(req.body?.sessionDurationMinutes, 20, 240) || 50;
      const countryCode = sanitizeString(req.body?.countryCode, 8);
      const phone = sanitizePhone(req.body?.phone);
      const professionalDocumentTypeRaw = sanitizeString(req.body?.documentType || req.body?.document_type, 10).toUpperCase();
      const professionalDocumentType = ['CPF', 'CNPJ', 'OTHER'].includes(professionalDocumentTypeRaw) ? professionalDocumentTypeRaw : 'CPF';
      const rawProfessionalDocument = sanitizeString(req.body?.documentNumber || req.body?.document_number || req.body?.cpf, 40);
      const professionalDocumentNumber = professionalDocumentType === 'OTHER'
        ? rawProfessionalDocument.replace(/[^A-Za-z0-9./-]/g, '')
        : rawProfessionalDocument.replace(/\D/g, '');
      const cpf = professionalDocumentType === 'CPF' ? normalizeCpf(professionalDocumentNumber) : '';
      const miniCurriculum = sanitizeString(req.body?.miniCurriculum || req.body?.mini_curriculum, 4000);
      const requestedClinicName = sanitizeString(req.body?.clinicName, 160);
      const requestedClinicLogoUrl = sanitizeUrl(req.body?.clinicLogoUrl);
      const requestedClinicLogoPath = sanitizeString(req.body?.clinicLogoPath, 260);
      const clinicCnpj = sanitizeString(req.body?.clinicCnpj, 24);
      const requestedClinicPhone = sanitizePhone(req.body?.clinicPhone);
      const clinicOperationTypeRaw = sanitizeString(req.body?.clinicOperationType || req.body?.clinic_operation_type, 40).toLowerCase();
      const clinicOperationType = ['private', 'insurance', 'mixed'].includes(clinicOperationTypeRaw)
        ? clinicOperationTypeRaw
        : 'mixed';
      const authoritativeSpecialty = normalizeClinicalSpecialty(context.membership?.specialty);
      const requestedSpecialty = normalizeClinicalSpecialty(req.body?.specialty) || null;
      const specialty = role === 'therapist'
        ? authoritativeSpecialty
        : ['supervisor', 'coordinator', 'director'].includes(String(role || '').toLowerCase())
          ? authoritativeSpecialty || requestedSpecialty
          : requestedSpecialty;
      if (!isProfessionalIdentifierInputValid(req.body?.council, 48) || !isProfessionalIdentifierInputValid(req.body?.councilNumber, 80)) {
        return res.status(400).json({ success: false, error: 'Conselho ou registro profissional contém caracteres inválidos.' });
      }
      const council = sanitizeProfessionalIdentifier(req.body?.council, 48);
      const councilNumber = sanitizeProfessionalIdentifier(req.body?.councilNumber, 80);
      const signatureDataUrl = sanitizeUrl(req.body?.signatureDataUrl);
      const signaturePath = sanitizeString(req.body?.signaturePath, 260);
      const profilePicture = sanitizeUrl(req.body?.profilePicture);
      const profilePicturePath = sanitizeString(req.body?.profilePicturePath, 260);
      const workSchedule = sanitizeProfessionalWorkingSchedule(req.body?.workSchedule || req.body?.work_schedule, sessionDurationMinutes);
      const currentSubscriptionStatus = normalizeClinicAccessStatus(req.session.user?.subscriptionStatus);
      const clinicSubscriptionStatus = normalizeClinicAccessStatus(context.clinic.subscriptionStatus);
      const nextSubscriptionStatus = isClinicManagedMember
        ? clinicSubscriptionStatus || currentSubscriptionStatus || null
        : CLINIC_ACCESS_ACTIVE_STATUSES.has(clinicSubscriptionStatus)
          ? clinicSubscriptionStatus
          : CLINIC_ACCESS_ACTIVE_STATUSES.has(currentSubscriptionStatus)
            ? currentSubscriptionStatus
            : 'payment_required';
      const nextBillingModel = isClinicManagedMember
        ? context.clinic.billingModel || req.session.user?.billingModel || null
        : role === 'patient'
          ? req.session.user?.billingModel || null
          : ACTIVE_PATIENT_BILLING_MODEL;
      const clinicName = isClinicManagedMember ? context.clinic.name : requestedClinicName;
      const clinicPhone = isClinicManagedMember ? context.clinic.phone : requestedClinicPhone;
      const clinicLogoUrl = isClinicManagedMember ? context.clinic.logoUrl : requestedClinicLogoUrl;
      const clinicLogoPath = isClinicManagedMember ? null : requestedClinicLogoPath;

      if (!fullName) {
        return res.status(400).json({ error: 'Nome completo é obrigatório.' });
      }
      if (role === 'therapist' && !specialty) {
        return res.status(409).json({
          success: false,
          code: 'ONBOARDING_SPECIALTY_NOT_RESOLVED',
          error: 'Não foi possível identificar a especialidade vinculada ao convite. Fale com o responsável da clínica.'
        });
      }
      if (isClinicManagedMember && role === 'therapist') {
        try {
          await assertNoOtherWorkspaceScheduleOverlap(userId, clinicId, workSchedule);
        } catch (scheduleError: any) {
          if (sanitizeString(scheduleError?.code, 120) === 'PROFESSIONAL_SCHEDULE_OTHER_WORKSPACE_CONFLICT') {
            return res.status(409).json({
              success: false,
              error: 'PROFESSIONAL_SCHEDULE_OTHER_WORKSPACE_CONFLICT',
              message: 'Este horário coincide com sua disponibilidade em outro local. Ajuste a escala para continuar.'
            });
          }
          throw scheduleError;
        }
      }

      const address = cleanObject({
        cep: cep || null,
        postalCode: cep || null,
        logradouro: logradouro || null,
        addressLine: logradouro || null,
        number: number || null,
        complement: complement || null,
        bairro: bairro || null,
        district: bairro || null,
        cidade: cidade || null,
        city: cidade || null,
        uf: uf || null,
        state: uf || null,
        ...(isClinicManagedMember ? {} : { cnpj: clinicCnpj || null }),
      });
      const userPatch = cleanObject({
        name: fullName,
        phone: phone || undefined,
        cpf: cpf || undefined,
        profile_picture: profilePicture || undefined,
        specialties: specialty || undefined,
        mini_curriculum: miniCurriculum || undefined,
        council: council || undefined,
        council_number: councilNumber || undefined,
        signature_url: signatureDataUrl || undefined,
        updated_at: new Date().toISOString(),
        ...(isClinicManagedMember ? {} : {
          subscription_status: nextSubscriptionStatus,
          billing_model: nextBillingModel,
        })
      });
      let safeUserPatch: Record<string, any> = { ...userPatch };
      let userUpdateError: any = null;
      for (let attempt = 0; attempt < 16 && Object.keys(safeUserPatch).length > 0; attempt += 1) {
        const updateResult = await supabase
          .from('users')
          .update(safeUserPatch)
          .eq('id', userId);
        userUpdateError = updateResult.error;
        if (!userUpdateError) break;
        const missingColumn = extractMissingColumnName(userUpdateError);
        if (!missingColumn || !(missingColumn in safeUserPatch)) break;
        delete safeUserPatch[missingColumn];
      }
      if (userUpdateError) throw userUpdateError;

      const existingProfileResult = await fetchProfessionalProfileWithSchemaFallback({
        supabase,
        userId,
        logger: console,
      });
      if (existingProfileResult.error && !isMissingRelationError(existingProfileResult.error)) {
        throw existingProfileResult.error;
      }
      const existingProfile = existingProfileResult.data as any;
      const existingMetadata = existingProfile?.metadata && typeof existingProfile.metadata === 'object'
        ? existingProfile.metadata
        : {};
      const globalSpecialty = normalizeClinicalSpecialty(
        existingProfile?.specialty || existingMetadata?.specialty,
      ) || specialty;
      const profileClinicName = isClinicManagedMember
        ? sanitizeString(existingProfile?.clinic_name, 160) || null
        : clinicName || null;
      const profileClinicLogoUrl = isClinicManagedMember
        ? sanitizeUrl(existingProfile?.clinic_logo_url)
        : clinicLogoUrl;
      const profileClinicPhone = isClinicManagedMember
        ? sanitizePhone(existingProfile?.clinic_phone)
        : clinicPhone;
      const { error: professionalProfileError } = await supabase
        .from('professional_profiles')
        .upsert([cleanObject({
          user_id: userId,
          full_name: fullName,
          birth_date: birthDate,
          gender,
          country_code: countryCode || null,
          phone,
          profile_photo_url: profilePicture,
          clinic_name: profileClinicName,
          clinic_logo_url: profileClinicLogoUrl,
          clinic_phone: profileClinicPhone,
          specialty: globalSpecialty,
          council,
          council_number: councilNumber,
          signature_data_url: signatureDataUrl,
          requires_onboarding: false,
          onboarding_completed_at: new Date().toISOString(),
          address,
          metadata: cleanObject({
            ...existingMetadata,
            role,
            sessionDurationMinutes,
            ...(isClinicManagedMember ? {} : {
              defaultSessionDurationMinutes: sessionDurationMinutes,
              workSchedule,
              work_schedule: workSchedule,
            }),
            cpf: cpf || null,
            documentType: professionalDocumentType,
            document_type: professionalDocumentType,
            documentNumber: professionalDocumentNumber || null,
            document_number: professionalDocumentNumber || null,
            miniCurriculum: miniCurriculum || null,
            mini_curriculum: miniCurriculum || null,
            specialty: globalSpecialty,
            professionalTitle: globalSpecialty,
            professional_title: globalSpecialty,
            ...(isClinicManagedMember ? {} : {
              clinicId,
              clinicAuthority: 'clinic_owner',
            }),
            clinicOperationType: isClinicManagedMember ? existingMetadata?.clinicOperationType : clinicOperationType,
            clinicCnpj: isClinicManagedMember ? existingMetadata?.clinicCnpj || null : clinicCnpj || null,
            profilePicturePath: profilePicturePath || null,
            clinicLogoPath: clinicLogoPath || null,
            signaturePath: signaturePath || null
          }),
          updated_at: new Date().toISOString()
        })], { onConflict: 'user_id' });
      if (professionalProfileError) throw professionalProfileError;

      if (isClinicManagedMember) {
        const membershipNow = new Date().toISOString();
        const { error: membershipSettingsError } = await supabase
          .from('clinic_memberships')
          .update({
            specialty: role === 'therapist' ? specialty : null,
            work_schedule: role === 'therapist' ? workSchedule : null,
            availability_timezone: currentClinicTimeZone(req.session.user),
            work_schedule_configured_at: role === 'therapist' ? membershipNow : null,
            settings_updated_at: membershipNow,
            settings_updated_by: userId,
            updated_at: membershipNow
          })
          .eq('user_id', userId)
          .eq('clinic_id', clinicId)
          .eq('status', 'active');
        if (membershipSettingsError) throw membershipSettingsError;
      }

      if (!isClinicManagedMember && clinicId && (role === 'director' || role === 'coordinator' || role === 'admin' || role === 'owner')) {
        const { error: clinicUpdateError } = await supabase
          .from('clinics')
          .upsert([{
            id: clinicId,
            owner_user_id: req.session.user.id,
            name: clinicName || 'Minha Clínica',
            logo_url: clinicLogoUrl,
            phone_commercial: clinicPhone,
            subscription_status: nextSubscriptionStatus,
            billing_model: nextBillingModel || ACTIVE_PATIENT_BILLING_MODEL,
            session_duration_minutes: sessionDurationMinutes,
            specialty,
            council,
            council_number: councilNumber,
            signature_data_url: signatureDataUrl,
            country_code: countryCode || null,
            address,
            updated_at: new Date().toISOString()
          }], { onConflict: 'id' });
        if (clinicUpdateError) throw clinicUpdateError;
      }

      const nextClinicSettings = isClinicManagedMember
        ? mergeAuthoritativeClinicSettings(req.session.user?.clinicSettings, context)
        : cleanObject({
            ...(req.session.user?.clinicSettings || {}),
            clinicName: clinicName || null,
            clinicLogoUrl: clinicLogoUrl || null,
            clinicCnpj: clinicCnpj || null,
            clinicPhone: clinicPhone || null,
            clinicOperationType,
            specialty: specialty || null,
            council: council || null,
            councilNumber: councilNumber || null,
            signatureDataUrl: signatureDataUrl || null,
            defaultSessionDuration: sessionDurationMinutes,
            workStart: req.session.user?.clinicSettings?.workStart || '08:00',
            workEnd: req.session.user?.clinicSettings?.workEnd || '18:00',
            clinicAddress: [logradouro, number, bairro, cidade].filter(Boolean).join(', ')
          });

      const authCompletionResult = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          clinic_settings: nextClinicSettings,
          first_login_completed: true,
          onboarding_mode: context.onboardingMode,
        }
      });
      if (authCompletionResult.error) throw authCompletionResult.error;

      const publicCompletionResult = await supabase
        .from('users')
        .update({
          first_login_completed: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (publicCompletionResult.error) {
        await supabase.auth.admin.updateUserById(userId, {
          user_metadata: {
            clinic_settings: nextClinicSettings,
            first_login_completed: false,
            onboarding_mode: context.onboardingMode,
          }
        }).catch(() => undefined);
        throw publicCompletionResult.error;
      }

      req.session.user = await hydrateSessionUserWithOnboardingContext({
        ...req.session.user,
        name: fullName,
        role,
        clinicId,
        activeWorkspaceId: clinicId,
        firstLoginCompleted: true,
        subscriptionStatus: nextSubscriptionStatus,
        billingModel: nextBillingModel,
        crp: councilNumber || req.session.user?.crp || null,
        cpf: cpf || req.session.user?.cpf || null,
        phone: phone || req.session.user?.phone || null,
        specialties: specialty || req.session.user?.specialties || null,
        miniCurriculum: miniCurriculum || req.session.user?.miniCurriculum || null,
        profilePicture:
          buildPatientPhotoViewUrl(extractPatientPhotosStoragePath(profilePicturePath)) ||
          sanitizeSessionUrl(profilePicture) ||
          req.session.user?.profilePicture ||
          null,
        signatureDataUrl:
          buildPatientPhotoViewUrl(extractPatientPhotosStoragePath(signaturePath)) ||
          sanitizeSessionUrl(signatureDataUrl) ||
          req.session.user?.signatureDataUrl ||
          null,
        clinicSettings: nextClinicSettings,
        onboardingContext: context,
        workspaces: compactWorkspacesForSession(await fetchUserWorkspaces(userId)),
      });

      req.session.save((err: any) => {
        if (err) {
          return res.status(500).json({ error: 'Erro ao salvar sessão' });
        }
        return res.json({
          success: true,
          subscriptionStatus: req.session.user.subscriptionStatus,
          onboardingMode: context.onboardingMode,
          requiresPayment: context.requiresPayment,
          onboardingContext: req.session.user.onboardingContext,
          user: req.session.user,
          onboardingState: context.requiresPayment ? 'PAYMENT_REQUIRED' : context.onboardingMode === 'clinic_owner' ? 'DIRECTOR_READY' : 'MEMBER_READY'
        });
      });
    } catch (error: any) {
      logRouteDbError('/api/profile/:userId/complete-onboarding', error, {
        userId: sanitizeString(userId, 120),
      });
      res.status(500).json({ error: 'Não foi possível concluir sua configuração agora.' });
    }
  };
}

type ResolvedClinicCapabilityContext = { role: string; capabilities: ReadonlySet<string>; clinicId: string; userId: string };
export function createProfessionalProfileSaveHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { buildSessionUserPayload, cleanObject, compactClinicSettingsForSession, compactWorkspacesForSession, currentClinicId, currentClinicTimeZone, extractMissingColumnName, fetchUserWorkspaces, invalidateReminderClinicBranding, isProfessionalIdentifierInputValid, logRouteDbError, normalizeCpf, patchTableSafely, requestIdForLogs, resolveClinicCapabilityContext, resolveClinicTimeZone, resolvePatientPhotoUrl, sanitizeEmail, sanitizePhone, sanitizePhoneE164, sanitizeProfessionalIdentifier, sanitizeSessionUrl, sanitizeString, sanitizeUrl, supabase } = getDeps();
    let profileSaveStage = 'authorize_self';
    try {
      // O perfil profissional é pessoal. Configurações institucionais exigem
      // escopo explícito + capability da membership ativa. Um save profissional
      // nunca deve depender da disponibilidade do resolver de módulos da clínica.
      if (req.session.user.id !== req.params.userId) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
      const requestedProfileSaveScope = sanitizeString(
        req.body?.profileSaveScope || req.body?.profile_save_scope,
        24
      ).toLowerCase();
      const profileSaveScope = requestedProfileSaveScope === 'clinic' ? 'clinic' : 'professional';
      let authorizationContext: ResolvedClinicCapabilityContext | null = null;
      let activeClinicRole = '';
      let canEditClinicSettings = false;
      if (profileSaveScope === 'clinic') {
        profileSaveStage = 'resolve_clinic_capability';
        authorizationContext = await resolveClinicCapabilityContext(req.session.user);
        activeClinicRole = sanitizeString(authorizationContext?.role, 40).toLowerCase();
        canEditClinicSettings = ['director', 'coordinator'].includes(activeClinicRole)
          && Boolean(authorizationContext?.capabilities?.has('clinic.settings.edit'));
        if (!canEditClinicSettings) {
          return res.status(403).json({
            success: false,
            error: 'CLINIC_SETTINGS_EDIT_DENIED',
            message: 'Seu acesso atual nesta clínica não permite alterar as configurações institucionais.'
          });
        }
      }

      const profilePicturePath = sanitizeString(req.body?.profilePicturePath || req.body?.profile_picture_path, 260);
      const signaturePath = sanitizeString(req.body?.signaturePath || req.body?.signature_path, 260);
      const clinicLogoPath = sanitizeString(req.body?.clinicLogoPath || req.body?.clinic_logo_path, 260);
      const professionalProfileInput =
        req.body?.professionalProfile && typeof req.body.professionalProfile === 'object'
          ? req.body.professionalProfile
          : {};
      const clinicSettingsInput =
        profileSaveScope === 'clinic' && canEditClinicSettings && req.body?.clinicSettings && typeof req.body.clinicSettings === 'object'
          ? req.body.clinicSettings
          : {};
      const rawResolvedCrp =
        req.body?.crp ??
        professionalProfileInput?.crp ??
        professionalProfileInput?.councilNumber ??
        professionalProfileInput?.council_number;
      const rawResolvedCouncil =
        req.body?.council ??
        professionalProfileInput?.council ??
        professionalProfileInput?.councilType ??
        professionalProfileInput?.council_type ??
        clinicSettingsInput?.council;
      const rawResolvedCouncilNumber =
        req.body?.councilNumber ??
        professionalProfileInput?.councilNumber ??
        professionalProfileInput?.council_number ??
        professionalProfileInput?.crp ??
        clinicSettingsInput?.councilNumber;
      if (
        !isProfessionalIdentifierInputValid(rawResolvedCrp, 80) ||
        !isProfessionalIdentifierInputValid(rawResolvedCouncil, 48) ||
        !isProfessionalIdentifierInputValid(rawResolvedCouncilNumber, 80)
      ) {
        return res.status(400).json({ success: false, error: 'Conselho ou registro profissional contém caracteres inválidos.' });
      }
      const resolvedCrp = sanitizeProfessionalIdentifier(rawResolvedCrp, 80);
      const resolvedCouncil = sanitizeProfessionalIdentifier(rawResolvedCouncil, 48);
      const resolvedCouncilNumber =
        sanitizeProfessionalIdentifier(rawResolvedCouncilNumber, 80) || resolvedCrp;
      const professionalCpf =
        normalizeCpf(req.body?.cpf) ||
        normalizeCpf(professionalProfileInput?.cpf || professionalProfileInput?.professionalCpf);
      const professionalPhone =
        sanitizePhone(req.body?.phone) ||
        sanitizePhone(professionalProfileInput?.phone || professionalProfileInput?.professionalPhone);
      const professionalRoleTitle = sanitizeString(
        req.body?.professionalRoleTitle ||
          professionalProfileInput?.roleTitle ||
          professionalProfileInput?.professionalRoleTitle,
        160
      );
      const professionalEmail = sanitizeEmail(req.session.user?.email);
      const professionalCouncilState = sanitizeString(
        professionalProfileInput?.councilState ||
          professionalProfileInput?.council_state ||
          req.body?.councilState,
        2
      ).toUpperCase();
      const professionalCboCode = sanitizeString(
        professionalProfileInput?.cboCode ||
          professionalProfileInput?.cbo_code ||
          req.body?.cboCode,
        40
      ).replace(/\D/g, '');
      const professionalSpecialtyName = sanitizeString(
        professionalProfileInput?.specialtyName ||
          professionalProfileInput?.specialty_name ||
          req.body?.specialtyName,
        120
      );
      const professionalFullName =
        sanitizeString(professionalProfileInput?.fullName || professionalProfileInput?.full_name || req.body?.name, 180) ||
        sanitizeString(req.body?.name, 180);
      const professionalDocumentTypeRaw = sanitizeString(
        professionalProfileInput?.documentType || professionalProfileInput?.document_type,
        10
      ).toUpperCase();
      const professionalDocumentType = ['CPF', 'CNPJ', 'OTHER'].includes(professionalDocumentTypeRaw)
        ? professionalDocumentTypeRaw
        : (professionalCpf ? 'CPF' : null);
      const rawProfessionalDocumentNumber = professionalProfileInput?.documentNumber || professionalProfileInput?.document_number || professionalCpf;
      if (professionalDocumentType === 'OTHER' && !isProfessionalIdentifierInputValid(rawProfessionalDocumentNumber, 80)) {
        return res.status(400).json({ success: false, error: 'Identificação profissional contém caracteres inválidos.' });
      }
      const professionalDocumentNumber = professionalDocumentType === 'OTHER'
        ? sanitizeProfessionalIdentifier(rawProfessionalDocumentNumber, 80)
        : sanitizeString(rawProfessionalDocumentNumber, 40).replace(/\D/g, '');
      const professionalAddressInput = professionalProfileInput?.address && typeof professionalProfileInput.address === 'object'
        ? professionalProfileInput.address
        : {};
      const professionalAddress = cleanObject({
        cep: sanitizeString(professionalAddressInput?.cep || professionalAddressInput?.postalCode, 20).replace(/\D/g, '') || null,
        logradouro: sanitizeString(professionalAddressInput?.logradouro || professionalAddressInput?.addressLine, 180) || null,
        number: sanitizeString(professionalAddressInput?.number || professionalAddressInput?.addressNumber, 40) || null,
        complement: sanitizeString(professionalAddressInput?.complement || professionalAddressInput?.addressComplement, 120) || null,
        bairro: sanitizeString(professionalAddressInput?.bairro || professionalAddressInput?.district, 120) || null,
        cidade: sanitizeString(professionalAddressInput?.cidade || professionalAddressInput?.city, 120) || null,
        uf: sanitizeString(professionalAddressInput?.uf || professionalAddressInput?.state, 2).toUpperCase() || null,
      });
      const clinicName = sanitizeString(clinicSettingsInput?.clinicName || req.body?.clinicName, 160);
      const clinicLegalName = sanitizeString(clinicSettingsInput?.clinicLegalName || clinicSettingsInput?.legalName || req.body?.clinicLegalName, 180);
      const clinicDocumentTypeSource = sanitizeString(clinicSettingsInput?.clinicDocumentType || clinicSettingsInput?.documentType || req.body?.clinicDocumentType, 10).toUpperCase();
      const clinicDocumentType = ['CPF', 'CNPJ'].includes(clinicDocumentTypeSource) ? clinicDocumentTypeSource : null;
      const clinicDocumentNumber = sanitizeString(
        clinicSettingsInput?.clinicDocumentNumber ||
          clinicSettingsInput?.documentNumber ||
          clinicSettingsInput?.clinicCnpj ||
          req.body?.clinicDocumentNumber ||
          req.body?.clinicCnpj,
        30
      ).replace(/\D/g, '');
      const clinicPhone = sanitizePhone(clinicSettingsInput?.clinicPhone || req.body?.clinicPhone);
      const clinicWhatsapp = sanitizePhone(clinicSettingsInput?.clinicWhatsapp || clinicSettingsInput?.whatsapp || req.body?.clinicWhatsapp);
      const clinicEmail = sanitizeEmail(clinicSettingsInput?.clinicEmail || req.body?.clinicEmail);
      const clinicSite = sanitizeString(clinicSettingsInput?.clinicSite || clinicSettingsInput?.site || req.body?.clinicSite, 180);
      const clinicAddress = sanitizeString(clinicSettingsInput?.clinicAddress || req.body?.clinicAddress, 260);
      const clinicAddressLine = sanitizeString(clinicSettingsInput?.clinicAddressLine || clinicSettingsInput?.addressLine || req.body?.clinicAddressLine, 180);
      const clinicAddressNumber = sanitizeString(clinicSettingsInput?.clinicAddressNumber || clinicSettingsInput?.addressNumber || req.body?.clinicAddressNumber, 40);
      const clinicAddressComplement = sanitizeString(clinicSettingsInput?.clinicAddressComplement || clinicSettingsInput?.addressComplement || req.body?.clinicAddressComplement, 120);
      const clinicDistrict = sanitizeString(clinicSettingsInput?.clinicDistrict || clinicSettingsInput?.district || req.body?.clinicDistrict, 120);
      const clinicCity = sanitizeString(clinicSettingsInput?.clinicCity || clinicSettingsInput?.city || req.body?.clinicCity, 120);
      const clinicState = sanitizeString(clinicSettingsInput?.clinicState || clinicSettingsInput?.state || req.body?.clinicState, 2).toUpperCase();
      const clinicTimeZone = resolveClinicTimeZone({
        timeZone:
          clinicSettingsInput?.clinicTimeZone ||
          clinicSettingsInput?.timezone ||
          req.body?.clinicTimeZone ||
          req.body?.timezone ||
          req.session.user?.clinicTimeZone ||
          req.session.user?.clinicSettings?.clinicTimeZone ||
          req.session.user?.clinicSettings?.timezone,
        state: clinicState || req.session.user?.clinicSettings?.clinicState || req.session.user?.clinicSettings?.state,
        fallback: currentClinicTimeZone(req.session.user),
      });
      const clinicPostalCode = sanitizeString(clinicSettingsInput?.clinicPostalCode || clinicSettingsInput?.postalCode || req.body?.clinicPostalCode, 20).replace(/\D/g, '');
      const clinicCnesCode = sanitizeString(clinicSettingsInput?.clinicCnesCode || clinicSettingsInput?.cnesCode || req.body?.clinicCnesCode, 40).replace(/\D/g, '');
      const clinicPatientPhotoPolicy = sanitizeString(
        clinicSettingsInput?.patientPhotoPolicy ||
        clinicSettingsInput?.patient_photo_policy ||
        req.session.user?.clinicSettings?.patientPhotoPolicy ||
        req.session.user?.clinicSettings?.patient_photo_policy ||
        'PORTAL',
        20,
      ).toUpperCase() === 'CLINIC' ? 'CLINIC' : 'PORTAL';
      const clinicProviderCode = sanitizeString(clinicSettingsInput?.clinicProviderCode || clinicSettingsInput?.providerCode || req.body?.clinicProviderCode, 80);
      const clinicCnpj = clinicDocumentNumber || sanitizeString(clinicSettingsInput?.clinicCnpj || req.body?.clinicCnpj, 30);

      const safePayload = cleanObject({
        id: sanitizeString(req.params.userId, 120),
        name: professionalFullName || undefined,
        // E-mail e papel são autoridades de autenticação/membership e não podem ser alterados por esta rota de perfil.
        profile_picture: sanitizeUrl(req.body?.profile_picture) || sanitizeUrl(req.body?.profilePicture) || undefined,
        crp: resolvedCrp || undefined,
        cpf: professionalCpf || undefined,
        phone:
          sanitizePhoneE164(req.body?.phone || req.body?.whatsappPhone || req.body?.whatsapp) ||
          professionalPhone ||
          undefined,
        signature_url:
          sanitizeUrl(req.body?.signature_url) ||
          sanitizeUrl(req.body?.signatureUrl) ||
          sanitizeUrl(req.body?.signatureDataUrl) ||
          sanitizeUrl(clinicSettingsInput?.signatureDataUrl) ||
          undefined,
        specialties: sanitizeString(req.body?.specialties, 1000) || undefined,
        mini_curriculum: sanitizeString(req.body?.mini_curriculum || req.body?.miniCurriculum, 4000) || undefined,
        updated_at: new Date().toISOString()
      });

      let candidate: Record<string, any> = { ...safePayload };
      const removedColumns = new Set<string>();
      let lastError: any = null;
      const profileUserId = sanitizeString(req.params.userId, 120);

      // A rota de perfil é PATCH semântico, não criação de conta. O antigo upsert
      // podia cair no caminho INSERT quando o shadow row de public.users estivesse
      // ausente e então violar users.email NOT NULL. Primeiro detectamos o estado
      // real: linhas existentes recebem UPDATE; somente um shadow row realmente
      // ausente pode ser reconstruído a partir da identidade autenticada da sessão.
      profileSaveStage = 'resolve_user_profile_row';
      const existingUserResult = await supabase
        .from('users')
        .select('id,email,role')
        .eq('id', profileUserId)
        .maybeSingle();
      if (existingUserResult.error) throw existingUserResult.error;
      let recoverMissingUserRow = !existingUserResult.data?.id;
      const recoveryEmail = sanitizeEmail(req.session.user?.email);
      const recoveryRole = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const recoveryClinicId = currentClinicId(req.session.user);
      const recoverySubscriptionStatus = sanitizeString(
        req.session.user?.subscriptionStatus || req.session.user?.subscription_status,
        40
      );
      const recoveryBillingModel = sanitizeString(
        req.session.user?.billingModel || req.session.user?.billing_model,
        40
      );
      if (recoverMissingUserRow && (!recoveryEmail || !recoveryRole)) {
        return res.status(409).json({
          success: false,
          error: 'PROFILE_USER_SHADOW_MISSING',
          message: 'A identidade autenticada precisa ser sincronizada antes de salvar o perfil.'
        });
      }

      profileSaveStage = 'persist_user_profile';
      for (let attempt = 0; attempt < 12; attempt += 1) {
        let error: any = null;
        if (recoverMissingUserRow) {
          const recoveryCandidate = cleanObject({
            ...candidate,
            id: profileUserId,
            email: recoveryEmail,
            role: recoveryRole,
            clinic_id: recoveryClinicId || undefined,
            subscription_status: recoverySubscriptionStatus || undefined,
            billing_model: recoveryBillingModel || undefined,
            created_at: new Date().toISOString(),
          });
          const recoveryResult = await supabase
            .from('users')
            .insert([recoveryCandidate])
            .select('id')
            .single();
          error = recoveryResult.error;
          // Corrida benigna: se outra requisição reconstruiu o shadow row entre
          // o SELECT e o INSERT, mudamos para UPDATE sem tocar email/role.
          if (error?.code === '23505') {
            recoverMissingUserRow = false;
            continue;
          }
        } else {
          const { id: _profileUserId, ...updateCandidate } = candidate as any;
          const updateResult = await supabase
            .from('users')
            .update(updateCandidate)
            .eq('id', profileUserId)
            .select('id')
            .maybeSingle();
          error = updateResult.error;
          if (!error && !updateResult.data?.id) {
            error = {
              code: 'PROFILE_USER_ROW_NOT_UPDATED',
              message: 'O perfil autenticado não possui shadow row atualizável em public.users.'
            };
          }
        }
        if (!error) {
          const role = sanitizeString(req.session.user?.role, 40).toLowerCase();
          const clinicId = currentClinicId(req.session.user);

          const currentProfilePictureUrl =
            sanitizeUrl(req.body?.profile_picture) ||
            sanitizeUrl(req.body?.profilePicture) ||
            undefined;
          const currentSignatureUrl =
            sanitizeUrl(req.body?.signature_url) ||
            sanitizeUrl(req.body?.signatureUrl) ||
            sanitizeUrl(req.body?.signatureDataUrl) ||
            sanitizeUrl(clinicSettingsInput?.signatureDataUrl) ||
            undefined;
          const currentClinicLogoUrl =
            sanitizeUrl(req.body?.clinic_logo_url) ||
            sanitizeUrl(req.body?.clinicLogoUrl) ||
            sanitizeUrl(clinicSettingsInput?.clinicLogoUrl) ||
            undefined;
          const pathProfilePictureUrl = profilePicturePath
            ? await resolvePatientPhotoUrl(currentProfilePictureUrl, profilePicturePath)
            : null;
          const pathSignatureUrl = signaturePath
            ? await resolvePatientPhotoUrl(currentSignatureUrl, signaturePath)
            : null;
          const pathClinicLogoUrl = clinicLogoPath
            ? await resolvePatientPhotoUrl(currentClinicLogoUrl, clinicLogoPath)
            : null;

          // Merge metadata so one partial update does not erase previously persisted media paths.
          const { data: existingProfile } = await supabase
            .from('professional_profiles')
            .select('metadata, profile_photo_url, signature_data_url, clinic_logo_url')
            .eq('user_id', sanitizeString(req.params.userId, 120))
            .maybeSingle();
          const existingMetadata =
            existingProfile?.metadata && typeof existingProfile.metadata === 'object'
              ? { ...(existingProfile.metadata as Record<string, any>) }
              : {};
          const resolvedProfilePictureUrl =
            currentProfilePictureUrl ||
            pathProfilePictureUrl ||
            sanitizeUrl(existingProfile?.profile_photo_url) ||
            sanitizeSessionUrl(req.session.user?.profilePicture) ||
            null;
          const resolvedSignatureUrl =
            currentSignatureUrl ||
            pathSignatureUrl ||
            sanitizeUrl(existingProfile?.signature_data_url) ||
            sanitizeSessionUrl(req.session.user?.signatureDataUrl) ||
            sanitizeSessionUrl(req.session.user?.clinicSettings?.signatureDataUrl) ||
            null;
          const resolvedClinicLogoUrl =
            currentClinicLogoUrl ||
            pathClinicLogoUrl ||
            sanitizeUrl(existingProfile?.clinic_logo_url) ||
            sanitizeSessionUrl(req.session.user?.clinicSettings?.clinicLogoUrl) ||
            null;

          const mergedMetadata = cleanObject({
            ...existingMetadata,
            cpf: professionalCpf || existingMetadata?.cpf || undefined,
            professionalCpf: professionalCpf || existingMetadata?.professionalCpf || undefined,
            phone: professionalPhone || existingMetadata?.phone || undefined,
            professionalPhone: professionalPhone || existingMetadata?.professionalPhone || undefined,
            email: professionalEmail || existingMetadata?.email || undefined,
            professionalEmail: professionalEmail || existingMetadata?.professionalEmail || undefined,
            documentType: professionalDocumentType || existingMetadata?.documentType || undefined,
            document_type: professionalDocumentType || existingMetadata?.document_type || undefined,
            documentNumber: professionalDocumentNumber || existingMetadata?.documentNumber || undefined,
            document_number: professionalDocumentNumber || existingMetadata?.document_number || undefined,
            roleTitle: professionalRoleTitle || existingMetadata?.roleTitle || undefined,
            professionalRoleTitle: professionalRoleTitle || existingMetadata?.professionalRoleTitle || undefined,
            council: resolvedCouncil || existingMetadata?.council || undefined,
            councilType: resolvedCouncil || existingMetadata?.councilType || undefined,
            councilNumber: resolvedCouncilNumber || existingMetadata?.councilNumber || existingMetadata?.council_number || undefined,
            council_number: resolvedCouncilNumber || existingMetadata?.council_number || existingMetadata?.councilNumber || undefined,
            crp: resolvedCrp || resolvedCouncilNumber || existingMetadata?.crp || undefined,
            councilState: professionalCouncilState || existingMetadata?.councilState || undefined,
            cboCode: professionalCboCode || existingMetadata?.cboCode || undefined,
            specialtyName: professionalSpecialtyName || existingMetadata?.specialtyName || undefined,
            clinicEmail: clinicEmail || existingMetadata?.clinicEmail || undefined,
            clinicAddress: clinicAddress || existingMetadata?.clinicAddress || undefined,
            clinicLegalName: clinicLegalName || existingMetadata?.clinicLegalName || undefined,
            clinicDocumentType: clinicDocumentType || existingMetadata?.clinicDocumentType || undefined,
            clinicDocumentNumber: clinicDocumentNumber || existingMetadata?.clinicDocumentNumber || undefined,
            clinicWhatsapp: clinicWhatsapp || existingMetadata?.clinicWhatsapp || undefined,
            clinicSite: clinicSite || existingMetadata?.clinicSite || undefined,
            clinicCnesCode: clinicCnesCode || existingMetadata?.clinicCnesCode || undefined,
            clinicProviderCode: clinicProviderCode || existingMetadata?.clinicProviderCode || undefined,
            profilePicturePath: profilePicturePath || existingMetadata?.profilePicturePath || undefined,
            signaturePath: signaturePath || existingMetadata?.signaturePath || undefined,
            clinicLogoPath: clinicLogoPath || existingMetadata?.clinicLogoPath || undefined
          });

          let profileCandidate: Record<string, any> = cleanObject({
            user_id: sanitizeString(req.params.userId, 120),
            clinic_id: clinicId || undefined,
            role: role || undefined,
            full_name: professionalFullName || undefined,
            phone: professionalPhone || undefined,
            council: resolvedCouncil || undefined,
            council_number: resolvedCouncilNumber || undefined,
            council_state: professionalCouncilState || undefined,
            cbo_code: professionalCboCode || undefined,
            crp: resolvedCrp || resolvedCouncilNumber || undefined,
            specialty:
              professionalSpecialtyName ||
              sanitizeString(req.body?.specialties || professionalProfileInput?.specialties, 240) ||
              undefined,
            mini_curriculum:
              sanitizeString(req.body?.miniCurriculum || professionalProfileInput?.miniCurriculum, 3000) ||
              undefined,
            address: Object.keys(professionalAddress).length > 0 ? professionalAddress : undefined,
            clinic_name: canEditClinicSettings ? clinicName || undefined : undefined,
            clinic_phone: canEditClinicSettings ? clinicPhone || undefined : undefined,
            profile_photo_url: resolvedProfilePictureUrl || undefined,
            signature_data_url: resolvedSignatureUrl || undefined,
            clinic_logo_url: canEditClinicSettings ? resolvedClinicLogoUrl || undefined : undefined,
            metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
            updated_at: new Date().toISOString()
          });
          profileSaveStage = 'persist_professional_profile';
          let professionalProfilePersisted = false;
          let professionalProfileWriteError: any = null;
          for (let profileAttempt = 0; profileAttempt < 10; profileAttempt += 1) {
            const { error: profileError } = await supabase
              .from('professional_profiles')
              .upsert([profileCandidate], { onConflict: 'user_id' });
            professionalProfileWriteError = profileError;
            if (!profileError) {
              professionalProfilePersisted = true;
              break;
            }
            const missingProfileColumn = extractMissingColumnName(profileError);
            if (!missingProfileColumn || !(missingProfileColumn in profileCandidate)) break;
            const { [missingProfileColumn]: _removed, ...rest } = profileCandidate as any;
            profileCandidate = rest;
          }

          // Alguns bancos legados possuem constraints antigas nos campos tipados de
          // conselho. Nesses casos, preservamos a autoridade no metadata JSONB, que já
          // é lido pelo resolver canônico, sem descartar o restante do perfil.
          if (!professionalProfilePersisted && professionalProfileWriteError) {
            let metadataFallbackCandidate: Record<string, any> = cleanObject({
              user_id: sanitizeString(req.params.userId, 120),
              full_name: professionalFullName || undefined,
              phone: professionalPhone || undefined,
              specialty:
                professionalSpecialtyName ||
                sanitizeString(req.body?.specialties || professionalProfileInput?.specialties, 240) ||
                undefined,
              mini_curriculum:
                sanitizeString(req.body?.miniCurriculum || professionalProfileInput?.miniCurriculum, 3000) ||
                undefined,
              metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
              updated_at: new Date().toISOString()
            });
            for (let fallbackAttempt = 0; fallbackAttempt < 8; fallbackAttempt += 1) {
              const { error: fallbackError } = await supabase
                .from('professional_profiles')
                .upsert([metadataFallbackCandidate], { onConflict: 'user_id' });
              professionalProfileWriteError = fallbackError;
              if (!fallbackError) {
                professionalProfilePersisted = true;
                break;
              }
              const missingFallbackColumn = extractMissingColumnName(fallbackError);
              if (!missingFallbackColumn || !(missingFallbackColumn in metadataFallbackCandidate)) break;
              const { [missingFallbackColumn]: _removed, ...rest } = metadataFallbackCandidate as any;
              metadataFallbackCandidate = rest;
            }
          }
          if (!professionalProfilePersisted) {
            throw professionalProfileWriteError || new Error('Falha ao persistir o perfil profissional.');
          }

          const nextClinicSettings = profileSaveScope === 'clinic' && canEditClinicSettings
            ? compactClinicSettingsForSession({
            ...(req.session.user?.clinicSettings || {}),
            ...clinicSettingsInput,
            ...(clinicName ? { clinicName } : {}),
            ...(clinicLegalName ? { clinicLegalName, legalName: clinicLegalName } : {}),
            ...(clinicDocumentType ? { clinicDocumentType, documentType: clinicDocumentType } : {}),
            ...(clinicDocumentNumber ? { clinicDocumentNumber } : {}),
            ...(clinicCnpj ? { clinicCnpj } : {}),
            ...(clinicPhone ? { clinicPhone } : {}),
            ...(clinicWhatsapp ? { clinicWhatsapp } : {}),
            ...(clinicEmail ? { clinicEmail } : {}),
            ...(clinicSite ? { clinicSite } : {}),
            ...(clinicAddress ? { clinicAddress } : {}),
            ...(clinicAddressLine ? { clinicAddressLine } : {}),
            ...(clinicAddressNumber ? { clinicAddressNumber } : {}),
            ...(clinicAddressComplement ? { clinicAddressComplement } : {}),
            ...(clinicDistrict ? { clinicDistrict } : {}),
            ...(clinicCity ? { clinicCity } : {}),
            ...(clinicState ? { clinicState } : {}),
            clinicTimeZone,
            timezone: clinicTimeZone,
            ...(clinicPostalCode ? { clinicPostalCode } : {}),
            ...(clinicCnesCode ? { clinicCnesCode } : {}),
            patientPhotoPolicy: clinicPatientPhotoPolicy,
            ...(clinicProviderCode ? { clinicProviderCode } : {}),
            ...(sanitizeProfessionalIdentifier(clinicSettingsInput?.council, 48)
              ? { council: sanitizeProfessionalIdentifier(clinicSettingsInput?.council, 48) }
              : {}),
            ...(sanitizeProfessionalIdentifier(clinicSettingsInput?.councilNumber, 80)
              ? { councilNumber: sanitizeProfessionalIdentifier(clinicSettingsInput?.councilNumber, 80) }
              : {}),
            clinicLogoUrl: resolvedClinicLogoUrl || null,
            signatureDataUrl: resolvedSignatureUrl || null,
            therapistSpecialties:
              sanitizeString(req.body?.specialties || clinicSettingsInput?.therapistSpecialties, 240) ||
              req.session.user?.clinicSettings?.therapistSpecialties ||
              null,
            therapistMiniCurriculum:
              sanitizeString(req.body?.miniCurriculum || clinicSettingsInput?.therapistMiniCurriculum, 3000) ||
              req.session.user?.clinicSettings?.therapistMiniCurriculum ||
              null,
          })
            : compactClinicSettingsForSession(req.session.user?.clinicSettings || {});

          if (clinicId && profileSaveScope === 'clinic' && canEditClinicSettings) {
            await patchTableSafely('clinics', { column: 'id', value: clinicId }, {
              name: clinicName || undefined,
              display_name: clinicName || undefined,
              legal_name: clinicLegalName || undefined,
              cnpj: clinicCnpj || undefined,
              clinic_cnpj: clinicCnpj || undefined,
              document_type: clinicDocumentType || undefined,
              document_number: clinicDocumentNumber || undefined,
              phone: clinicPhone || undefined,
              clinic_phone: clinicPhone || undefined,
              whatsapp: clinicWhatsapp || undefined,
              email: clinicEmail || undefined,
              clinic_email: clinicEmail || undefined,
              site: clinicSite || undefined,
              address: clinicAddress || undefined,
              clinic_address: clinicAddress || undefined,
              address_line: clinicAddressLine || undefined,
              address_number: clinicAddressNumber || undefined,
              address_complement: clinicAddressComplement || undefined,
              district: clinicDistrict || undefined,
              city: clinicCity || undefined,
              state: clinicState || undefined,
              timezone: clinicTimeZone,
              postal_code: clinicPostalCode || undefined,
              cnes_code: clinicCnesCode || undefined,
              patient_photo_policy: clinicPatientPhotoPolicy,
              provider_code: clinicProviderCode || undefined,
              logo_url: resolvedClinicLogoUrl || undefined,
              signature_data_url: resolvedSignatureUrl || undefined,
              updated_at: new Date().toISOString()
            });
            invalidateReminderClinicBranding(clinicId);
          }

          if (nextClinicSettings) {
            await supabase.auth.admin.updateUserById(sanitizeString(req.params.userId, 120), {
              user_metadata: cleanObject({
                ...((req.session.user as any)?.user_metadata || {}),
                professional_profile: cleanObject({
                  cpf: professionalCpf || undefined,
                  professionalCpf: professionalCpf || undefined,
                  phone: professionalPhone || undefined,
                  professionalPhone: professionalPhone || undefined,
                  roleTitle: professionalRoleTitle || undefined,
                  professionalRoleTitle: professionalRoleTitle || undefined,
                  council: resolvedCouncil || undefined,
                  councilType: resolvedCouncil || undefined,
                  councilState: professionalCouncilState || undefined,
                  cboCode: professionalCboCode || undefined,
                  specialtyName: professionalSpecialtyName || undefined,
                  crp: resolvedCrp || resolvedCouncilNumber || undefined,
                  documentType: professionalDocumentType || undefined,
                  documentNumber: professionalDocumentNumber || undefined,
                  address: Object.keys(professionalAddress).length > 0 ? professionalAddress : undefined
                }),
                clinic_settings: nextClinicSettings,
                first_login_completed:
                  typeof req.session.user?.firstLoginCompleted === 'boolean'
                    ? req.session.user.firstLoginCompleted
                    : true
              })
            });
          }

          req.session.user.name =
            sanitizeString(req.body?.name, 180) ||
            req.session.user?.name ||
            req.session.user?.email ||
            'Profissional';
          req.session.user.profilePicture = resolvedProfilePictureUrl;
          req.session.user.cpf = professionalCpf || req.session.user?.cpf || null;
          req.session.user.phone = professionalPhone || req.session.user?.phone || null;
          req.session.user.professionalRoleTitle = professionalRoleTitle || req.session.user?.professionalRoleTitle || null;
          req.session.user.professionalProfile = cleanObject({
            ...(req.session.user?.professionalProfile || {}),
            fullName: professionalFullName || req.session.user?.professionalProfile?.fullName || null,
            cpf: professionalCpf || req.session.user?.professionalProfile?.cpf || null,
            phone: professionalPhone || req.session.user?.professionalProfile?.phone || null,
            roleTitle: professionalRoleTitle || req.session.user?.professionalProfile?.roleTitle || null,
            crp: resolvedCrp || resolvedCouncilNumber || req.session.user?.professionalProfile?.crp || null,
            council: resolvedCouncil || req.session.user?.professionalProfile?.council || null,
            councilState: professionalCouncilState || req.session.user?.professionalProfile?.councilState || null,
            cboCode: professionalCboCode || req.session.user?.professionalProfile?.cboCode || null,
            specialtyName: professionalSpecialtyName || req.session.user?.professionalProfile?.specialtyName || null,
            specialties:
              sanitizeString(req.body?.specialties || professionalProfileInput?.specialties, 240) ||
              req.session.user?.professionalProfile?.specialties ||
              null,
            miniCurriculum:
              sanitizeString(req.body?.miniCurriculum || professionalProfileInput?.miniCurriculum, 3000) ||
              req.session.user?.professionalProfile?.miniCurriculum ||
              null,
            profilePhotoUrl: resolvedProfilePictureUrl || null,
            profilePicture: resolvedProfilePictureUrl || null,
            profilePicturePath: profilePicturePath || mergedMetadata?.profilePicturePath || null,
            metadata: mergedMetadata
          });
          req.session.user.signatureDataUrl = resolvedSignatureUrl;
          req.session.user.clinicTimeZone = clinicTimeZone;
          req.session.user.clinic_timezone = clinicTimeZone;
          req.session.user.clinicSettings = nextClinicSettings;
          req.session.user.workspaces = profileSaveScope === 'clinic'
            ? compactWorkspacesForSession(await fetchUserWorkspaces(req.session.user.id))
            : compactWorkspacesForSession(req.session.user?.workspaces || []);
          req.session.user.crp =
            resolvedCrp ||
            resolvedCouncilNumber ||
            req.session.user?.crp ||
            null;
          req.session.user.specialties =
            sanitizeString(req.body?.specialties, 1000) ||
            req.session.user?.specialties ||
            null;
          req.session.user.miniCurriculum =
            sanitizeString(req.body?.mini_curriculum || req.body?.miniCurriculum, 4000) ||
            req.session.user?.miniCurriculum ||
            null;

          profileSaveStage = 'persist_session';
          await new Promise<void>((resolve, reject) => {
            req.session.save((sessionError: any) => {
              if (sessionError) {
                reject(sessionError);
                return;
              }
              resolve();
            });
          });

          return res.json({
            success: true,
            user: buildSessionUserPayload(req.session.user)
          });
        }

        lastError = error;
        const missingColumn = extractMissingColumnName(error);
        if (!missingColumn || removedColumns.has(missingColumn)) {
          break;
        }

        removedColumns.add(missingColumn);
        const { [missingColumn]: _removed, ...rest } = candidate as any;
        candidate = rest;
      }

      throw lastError || new Error('Falha ao salvar perfil.');
    } catch (error: any) {
      logRouteDbError('/api/profile/:userId [POST]', error, {
        stage: profileSaveStage,
        userId: sanitizeString(req.params?.userId, 120),
        requesterId: sanitizeString(req.session?.user?.id, 120),
        profileSaveScope: sanitizeString(req.body?.profileSaveScope || req.body?.profile_save_scope, 24).toLowerCase() || 'professional',
        requestId: requestIdForLogs(req)
      });
      return res.status(500).json({
        success: false,
        error: 'PROFILE_SAVE_FAILED',
        message: 'Não foi possível salvar o perfil agora.'
      });
    }
  };
}
