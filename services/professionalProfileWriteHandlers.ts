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
