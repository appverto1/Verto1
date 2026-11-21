// Surgical extraction of patient-account provisioning. Keep identity/linkage writes and response flow unchanged.
type ResolvedClinicCapabilityContext = { role: string; userId: string; clinicId: string; capabilities: ReadonlySet<string> };
export function createPatientAccountProvisioningHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { supabase, crypto, sanitizeEmail, sanitizeString, normalizePatientProfileType, mapPatientProfileTypeToLegacyPortalType, normalizeCpf, normalizeBrazilMobilePhone, buildPatientIdentityPersistenceFields, requestIdForLogs, derivePatientSpecialtyKeysFromPayload, patientPayloadRequestsGenericPayerCapability, patientPayloadRequestsInsuranceCreateCapability, isUuid, cleanObject, extractMissingColumnName, findDuplicatePatientInClinic, persistActivityLog, maskEmail, findPatientSpecialtyConflictAcrossClinics, PATIENT_STATUS_PENDING_CONFIRMATION, PATIENT_STATUS_PENDING_ANAMNESIS, RELATIONSHIP_PENDING, RELATIONSHIP_CONFIRMED, ONBOARDING_NOT_STARTED, updatePatientOnboardingWithSchemaFallback, updateRowsWithSchemaFallback, buildPatientGlobalIdentityUpdate, findAuthUserByEmail, createPatientActivationLink, buildActivationEmailTemplate, sendTransactionalEmailSafe, OFFICIAL_FROM_NOREPLY, OFFICIAL_TRANSACTIONAL_REPLY_TO, createRelationshipConfirmationRequest, isMissingRelationError, queueActivePatientSync } = getDeps();
    const { email, name, type, cpf } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
      const safeEmail = sanitizeEmail(email);
      const safeName = sanitizeString(name, 160) || String(safeEmail || email).split('@')[0];
      const canonicalProfileType = normalizePatientProfileType(
        req.body?.patientProfileType || req.body?.patient_profile_type || req.body?.panelType || req.body?.panel_type || type,
      );
      const normalizedPortalType = mapPatientProfileTypeToLegacyPortalType(canonicalProfileType);
      const safeClinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120);
      const safeProfessionalId = sanitizeString(req.session.user?.id, 120);
      const normalizedEmail = String(safeEmail || email || '').trim().toLowerCase();
      const normalizedCpf = normalizeCpf(cpf);
      const rawPhone = req.body?.phone ?? req.body?.telefone;
      const normalizedPhone = normalizeBrazilMobilePhone(rawPhone);
      const identityPersistenceFields = buildPatientIdentityPersistenceFields(req.body);
      const requestClientRecordId = sanitizeString(req.body?.clientRecordId || req.body?.client_record_id || req.body?.localId, 120);
      const routeRequestId = requestIdForLogs(req);
      const requestedSpecialtyKeys = derivePatientSpecialtyKeysFromPayload({
        ...(req.body || {}),
        patientProfileType: canonicalProfileType,
        patient_profile_type: canonicalProfileType,
        type: normalizedPortalType
      });
      const context = req.authorizationContext as ResolvedClinicCapabilityContext;
      if (
        patientPayloadRequestsGenericPayerCapability(req.body) &&
        !context.capabilities.has('finance.entries.manage') &&
        !context.capabilities.has('patient.insurance.create')
      ) {
        return res.status(403).json({ success: false, error: 'PATIENT_PAYER_CONTEXT_CAPABILITY_REQUIRED' });
      }
      if (
        patientPayloadRequestsInsuranceCreateCapability(req.body) &&
        !context.capabilities.has('patient.insurance.create')
      ) {
        return res.status(403).json({
          success: false,
          error: 'PATIENT_INSURANCE_CREATE_CAPABILITY_REQUIRED'
        });
      }
      if (!normalizedEmail) {
        return res.status(400).json({ success: false, error: 'Email inválido.' });
      }
      if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() && !normalizedPhone) {
        return res.status(400).json({
          success: false,
          error: 'Telefone inválido. Informe DDD + 9 dígitos (11 números).'
        });
      }
      if (cpf !== undefined && cpf !== null && String(cpf).trim() && !normalizedCpf) {
        return res.status(400).json({
          success: false,
          error: 'CPF inválido. Informe 11 dígitos.'
        });
      }

      const isAuthEmailAlreadyRegisteredError = (rawError: any) => {
        const message = String(rawError?.message || rawError?.error_description || rawError || '').toLowerCase();
        const code = String(rawError?.code || rawError?.status || '').toLowerCase();
        return (
          code === 'email_exists' ||
          code === 'user_already_exists' ||
          /already\s+(registered|exists)/i.test(message) ||
          /user\s+already\s+registered/i.test(message) ||
          /email.*already.*(registered|exists|taken|in use)/i.test(message) ||
          /duplicate.*email/i.test(message)
        );
      };

      const isDuplicateConstraintError = (rawError: any) => {
        const message = String(rawError?.message || rawError?.details || rawError || '').toLowerCase();
        const code = String(rawError?.code || '').trim();
        return code === '23505' || /duplicate key|unique constraint|already exists|duplicado|já existe/i.test(message);
      };

      const findAuthUserByEmailForPatientCreate = async (targetEmail: string): Promise<any | null> => {
        // Não enumerar Auth users neste fluxo: em produção isso pode travar/estourar timeout
        // quando a base cresce. A rota só faz vínculo automático se já houver perfil público
        // compatível em users; se o e-mail existir apenas no Auth, retornamos conflito revisável
        // seguro, sem 500/502 e sem vazar dados entre clínicas.
        void targetEmail;
        return null;
      };

      const PATIENT_INVITE_BACKGROUND_TIMEOUT_MS = 7_000;

      const updatePatientInviteStatus = async (
        authUserId: string | null,
        status: 'INVITE_QUEUED' | 'INVITE_SENT' | 'INVITE_FAILED_RETRYABLE',
        reason?: string
      ) => {
        if (!authUserId || !isUuid(authUserId)) return;
        let inviteStatusPayload: Record<string, any> = cleanObject({
          invite_status: status,
          activation_invite_status: status,
          activation_email_status: status === 'INVITE_SENT'
            ? 'sent'
            : status === 'INVITE_FAILED_RETRYABLE'
              ? 'failed_retryable'
              : 'queued',
          invite_status_reason: reason ? sanitizeString(reason, 180) : undefined,
          updated_at: new Date().toISOString()
        });

        while (Object.keys(inviteStatusPayload).length > 0) {
          const { error: inviteStatusError } = await supabase
            .from('users')
            .update(inviteStatusPayload)
            .eq('id', authUserId);

          if (!inviteStatusError) return;

          const missingColumn = extractMissingColumnName(inviteStatusError);
          if (!missingColumn || !(missingColumn in inviteStatusPayload)) {
            console.warn('[PatientCreateUser] falha ao atualizar status do convite:', {
              requestId: routeRequestId,
              organization_id: isUuid(safeClinicId) ? safeClinicId : null,
              route: '/api/patients/create-user',
              action: 'update_invite_status',
              status,
              message: sanitizeString(inviteStatusError?.message || String(inviteStatusError), 180)
            });
            return;
          }
          delete inviteStatusPayload[missingColumn];
        }
      };

      const sendPatientInviteInBackground = (
        input: { context: string; authUserId?: string | null }
      ) => {
        setTimeout(() => {
          void (async () => {
            try {
              const emailResult = await Promise.race([
                sendPatientActivationEmail(input.authUserId || null),
                new Promise<{ sent: false; reason: string }>((resolve) => {
                  setTimeout(() => {
                    resolve({ sent: false, reason: 'Timeout no envio do e-mail de ativação.' });
                  }, PATIENT_INVITE_BACKGROUND_TIMEOUT_MS);
                })
              ]);

              if (emailResult.sent) {
                await updatePatientInviteStatus(input.authUserId || null, 'INVITE_SENT');
                return;
              }

              await updatePatientInviteStatus(
                input.authUserId || null,
                'INVITE_FAILED_RETRYABLE',
                emailResult.reason || 'Falha no envio do e-mail de ativação.'
              );
              console.warn('[PatientCreateUser] envio assíncrono de ativação não concluído:', {
                requestId: routeRequestId,
                organization_id: isUuid(safeClinicId) ? safeClinicId : null,
                patient_id: requestClientRecordId || null,
                route: '/api/patients/create-user',
                action: 'send_patient_invite_background',
                context: input.context,
                status: 'INVITE_FAILED_RETRYABLE',
                email: maskEmail(normalizedEmail),
                message: sanitizeString(emailResult.reason || 'Falha no envio do e-mail de ativação.', 180)
              });
            } catch (emailError: any) {
              await updatePatientInviteStatus(
                input.authUserId || null,
                'INVITE_FAILED_RETRYABLE',
                sanitizeString(emailError?.message || String(emailError), 180)
              );
              console.warn('[PatientCreateUser] envio assíncrono de ativação falhou:', {
                requestId: routeRequestId,
                organization_id: isUuid(safeClinicId) ? safeClinicId : null,
                patient_id: requestClientRecordId || null,
                route: '/api/patients/create-user',
                action: 'send_patient_invite_background',
                context: input.context,
                status: 'INVITE_FAILED_RETRYABLE',
                email: maskEmail(normalizedEmail),
                code: sanitizeString(emailError?.code, 40) || null,
                message: sanitizeString(emailError?.message || String(emailError), 180)
              });
            }
          })();
        }, 0);
      };

      const duplicatePatient = await findDuplicatePatientInClinic({
        clinicId: safeClinicId,
        name: safeName,
        email: normalizedEmail,
        cpf: normalizedCpf,
        clientRecordId: requestClientRecordId
      });
      if (duplicatePatient) {
        void persistActivityLog({
          userId: sanitizeString(req.session.user?.id, 120),
          clinicId: safeClinicId,
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuario', 180),
          title: 'Paciente já cadastrado na clínica',
          content: 'Cadastro confirmado sem duplicar paciente.',
          type: 'management',
          actionType: 'PATIENT_ALREADY_EXISTS_SAME_CLINIC',
          payload: {
            field: duplicatePatient.field,
            email: maskEmail(normalizedEmail),
            hasCpf: Boolean(normalizedCpf)
          }
        });
        return res.json({
          success: true,
          idempotent: true,
          code: 'PATIENT_ALREADY_EXISTS_SAME_CLINIC',
          status: 'ALREADY_LINKED',
          message: 'Paciente já cadastrado nesta clínica.',
          activationEmailSent: null,
          portabilityAvailable: true,
          patient: {
            name: duplicatePatient.patientName,
            status: sanitizeString(duplicatePatient.row?.status, 40) || 'active'
          }
        });
      }

      const crossClinicSpecialtyConflict = await findPatientSpecialtyConflictAcrossClinics({
        clinicId: safeClinicId,
        email: normalizedEmail,
        cpf: normalizedCpf,
        requestedSpecialtyKeys,
        excludePatientId: requestClientRecordId
      });
      if (crossClinicSpecialtyConflict) {
        return res.status(409).json({
          success: false,
          status: 'SPECIALTY_CONFLICT_REQUIRES_REVIEW',
          code: 'PATIENT_SPECIALTY_CONFLICT_OTHER_CLINIC',
          error: 'Este paciente já está vinculado a outra clínica nesta mesma especialidade.',
          specialty: crossClinicSpecialtyConflict.specialtyKey
        });
      }

      const upsertPatientProfile = async (authUserId: string) => {
        const profilePayload = cleanObject({
          id: authUserId,
          email: normalizedEmail,
          name: safeName,
          role: 'patient',
          type: normalizedPortalType,
          patient_profile_type: canonicalProfileType,
          panel_type: canonicalProfileType,
          subscription_status: 'pending',
          plan_name: null,
          plan_price: null,
          clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
          status: 'pending_activation',
          first_login_completed: false,
          created_at: new Date().toISOString()
        });

        let safeProfilePayload: Record<string, any> = { ...profilePayload };
        while (Object.keys(safeProfilePayload).length > 0) {
          const { error: profileError } = await supabase
            .from('users')
            .upsert([safeProfilePayload], { onConflict: 'id' });

          if (!profileError) {
            await supabase.auth.admin.updateUserById(authUserId, {
              user_metadata: {
                full_name: safeName,
                role: 'patient',
                type: normalizedPortalType,
                patient_profile_type: canonicalProfileType,
                panel_type: canonicalProfileType,
                clinic_id: isUuid(safeClinicId) ? safeClinicId : null,
                invited_email: normalizedEmail,
                patient_activation_required: true,
                first_login_completed: false
              }
            });
            return;
          }

          const missingColumn = extractMissingColumnName(profileError);
          if (!missingColumn || !(missingColumn in safeProfilePayload)) {
            throw profileError;
          }
          delete safeProfilePayload[missingColumn];
        }
      };

      const ensurePatientLink = async (
        authUserId: string,
        options: { existingAccount?: boolean } = {}
      ): Promise<string | null> => {
          const existingAccount = options.existingAccount === true;
          const nextPatientStatus = existingAccount
            ? PATIENT_STATUS_PENDING_CONFIRMATION
            : PATIENT_STATUS_PENDING_ANAMNESIS;
          const nextRelationshipStatus = existingAccount ? RELATIONSHIP_PENDING : RELATIONSHIP_CONFIRMED;
          const nextOnboardingStatus = ONBOARDING_NOT_STARTED;
          const patientPayloadBase = cleanObject({
            name: safeName,
            email: safeEmail,
            phone: normalizedPhone || undefined,
            cpf: normalizedCpf || undefined,
            ...identityPersistenceFields,
            status: nextPatientStatus,
            onboarding_status: nextOnboardingStatus,
            anamnesis_required: true,
            relationship_status: nextRelationshipStatus,
            type: normalizedPortalType,
            patient_profile_type: canonicalProfileType,
            panel_type: canonicalProfileType,
            profile_type: canonicalProfileType,
            clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
            therapist_id: isUuid(safeProfessionalId) ? safeProfessionalId : undefined,
            responsible_user_id: isUuid(authUserId) ? authUserId : undefined,
            client_record_id: requestClientRecordId || undefined,
            created_at: new Date().toISOString()
        });
        if (!patientPayloadBase.email) return null;

        const existingPatient = await findDuplicatePatientInClinic({
          clinicId: patientPayloadBase.clinic_id,
          name: safeName,
          email: patientPayloadBase.email,
          cpf: normalizedCpf,
          clientRecordId: requestClientRecordId
        });
        const linkedPatientId = sanitizeString(existingPatient?.patientId, 120) ||
          (isUuid(requestClientRecordId) ? requestClientRecordId : crypto.randomUUID());

          const upsertPatientData = cleanObject({
            id: existingPatient?.patientId ? undefined : linkedPatientId,
            name: safeName,
            email: safeEmail,
            phone: normalizedPhone || undefined,
            cpf: normalizedCpf || undefined,
            ...identityPersistenceFields,
            status: nextPatientStatus,
            onboarding_status: nextOnboardingStatus,
            anamnesis_required: true,
            relationship_status: nextRelationshipStatus,
            type: normalizedPortalType,
            patient_profile_type: canonicalProfileType,
            panel_type: canonicalProfileType,
            profile_type: canonicalProfileType,
            clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
            therapist_id: isUuid(safeProfessionalId) ? safeProfessionalId : undefined,
            responsible_user_id: isUuid(authUserId) ? authUserId : undefined,
            client_record_id: requestClientRecordId || undefined
          });
          const fallbackPatientData = cleanObject({
            id: existingPatient?.patientId ? undefined : linkedPatientId,
            name: safeName,
            email: safeEmail,
            phone: normalizedPhone || undefined,
            status: 'pending',
            clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
            therapist_id: isUuid(safeProfessionalId) ? safeProfessionalId : undefined,
            responsible_user_id: isUuid(authUserId) ? authUserId : undefined
          });

        if (existingPatient?.patientId) {
          const updateResult = await updatePatientOnboardingWithSchemaFallback({
            patientId: existingPatient.patientId,
            clinicId: safeClinicId,
            patch: upsertPatientData,
            context: 'patient-create-user-existing-link'
          });
          if (!updateResult.success) {
            const fallbackUpdate = await updateRowsWithSchemaFallback({
              tableName: 'patients',
              payload: fallbackPatientData,
              filters: [{ column: 'id', value: existingPatient.patientId }],
              context: 'patient-create-user-existing-link-fallback'
            });
            if (!fallbackUpdate.success) throw fallbackUpdate.error;
          }
        } else {
          const { error: insertPatientError } = await supabase.from('patients').insert([{
            ...upsertPatientData,
            created_at: new Date().toISOString()
          }]);
          if (insertPatientError) {
            const insertMessage = String(insertPatientError?.message || '').toLowerCase();
            const schemaMismatch = Boolean(extractMissingColumnName(insertPatientError)) || insertMessage.includes('column');
            const statusConstraint = sanitizeString(insertPatientError?.code, 20) === '23514' || insertMessage.includes('check constraint');
            if (!schemaMismatch && !statusConstraint) {
              if (isDuplicateConstraintError(insertPatientError)) return linkedPatientId;
              throw insertPatientError;
            }
            const { error: insertFallbackError } = await supabase.from('patients').insert([{
              ...fallbackPatientData,
              created_at: new Date().toISOString()
            }]);
            if (insertFallbackError) {
              if (isDuplicateConstraintError(insertFallbackError)) return linkedPatientId;
              throw insertFallbackError;
            }
          }
        }

        const { data: persistedPatientLink, error: persistedPatientLinkError } = await supabase
          .from('patients')
          .select('responsible_user_id')
          .eq('id', linkedPatientId)
          .eq('clinic_id', safeClinicId)
          .maybeSingle();
        if (persistedPatientLinkError) throw persistedPatientLinkError;
        if (sanitizeString(persistedPatientLink?.responsible_user_id, 120) !== authUserId) {
          const persistenceError: any = new Error('PATIENT_RESPONSIBLE_LINK_NOT_PERSISTED');
          persistenceError.code = 'PATIENT_RESPONSIBLE_LINK_NOT_PERSISTED';
          throw persistenceError;
        }

        const globalIdentityUpdate = buildPatientGlobalIdentityUpdate({
          existingAccount,
          portalType: normalizedPortalType,
          clinicId: isUuid(safeClinicId) ? safeClinicId : null,
        });
        if (!globalIdentityUpdate) return linkedPatientId;

        let safeUserUpdatePayload: Record<string, any> = cleanObject(globalIdentityUpdate);

        while (Object.keys(safeUserUpdatePayload).length > 0) {
          const { error: userUpdateError } = await supabase
            .from('users')
            .update(safeUserUpdatePayload)
            .eq('id', authUserId);

          if (!userUpdateError) break;

          const missingColumn = extractMissingColumnName(userUpdateError);
          if (!missingColumn || !(missingColumn in safeUserUpdatePayload)) {
            throw userUpdateError;
          }
          delete safeUserUpdatePayload[missingColumn];
        }
        return linkedPatientId;
      };

      const sendPatientActivationEmail = async (authUserId?: string | null): Promise<{ sent: boolean; reason?: string }> => {
        const safeAuthUserId = sanitizeString(authUserId, 120);
        const authUserResult = isUuid(safeAuthUserId)
          ? await supabase.auth.admin.getUserById(safeAuthUserId)
          : { data: { user: await findAuthUserByEmail(normalizedEmail) }, error: null as any };
        if (authUserResult?.error) throw authUserResult.error;
        const activationAuthUser = authUserResult?.data?.user || null;
        if (!activationAuthUser?.id || sanitizeEmail(activationAuthUser.email) !== normalizedEmail) {
          throw new Error('PATIENT_ACTIVATION_AUTH_USER_NOT_FOUND');
        }
        const activationLink = await createPatientActivationLink(activationAuthUser);

        const activationEmail = buildActivationEmailTemplate({
          nome: safeName,
          link_ativacao: activationLink,
          perfil: 'patient'
        });

        let sent = await sendTransactionalEmailSafe({
          to: normalizedEmail,
          subject: activationEmail.subject,
          html: activationEmail.html,
          context: 'patient_create_user_activation',
          from: OFFICIAL_FROM_NOREPLY,
          replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
          templateKind: 'welcome_patient',
          templateData: activationEmail.variables,
          metadata: {
            email: maskEmail(normalizedEmail),
            clinicId: isUuid(safeClinicId) ? safeClinicId : null
          }
        });

        if (!sent) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          sent = await sendTransactionalEmailSafe({
            to: normalizedEmail,
            subject: activationEmail.subject,
            html: activationEmail.html,
            context: 'patient_create_user_activation_retry',
            from: OFFICIAL_FROM_NOREPLY,
            replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
            templateKind: 'welcome_patient',
            templateData: activationEmail.variables,
            metadata: {
              email: maskEmail(normalizedEmail),
              clinicId: isUuid(safeClinicId) ? safeClinicId : null,
              retry: true
            }
          });
        }

        if (!sent) {
          return { sent: false, reason: 'Falha no envio do e-mail de ativação.' };
        }
        return { sent: true };
      };

      const sendRelationshipConfirmationForLinkedPatient = async (
        authUserId: string,
        linkedPatientId: string | null,
        source: string
      ) => {
        const patientId = sanitizeString(linkedPatientId, 120);
        if (!isUuid(patientId)) {
          return { sent: false, confirmationId: null, reason: 'Paciente vinculado não localizado.' };
        }

        await updatePatientOnboardingWithSchemaFallback({
          patientId,
          clinicId: safeClinicId,
          patch: {
            status: PATIENT_STATUS_PENDING_CONFIRMATION,
            onboarding_status: ONBOARDING_NOT_STARTED,
            relationship_status: RELATIONSHIP_PENDING,
            anamnesis_required: true
          },
          context: `patient-create-user-${source}-relationship-pending`
        });

        const confirmation = await createRelationshipConfirmationRequest({
          patientId,
          clinicId: safeClinicId,
          email: normalizedEmail,
          patientName: safeName,
          responsibleUserId: authUserId,
          createdBy: safeProfessionalId,
          metadata: {
            source,
            requestedSpecialtyKeys,
            clientRecordId: requestClientRecordId || null
          }
        });

        if (!confirmation.success && confirmation.error && !isMissingRelationError(confirmation.error)) {
          console.warn('[PatientCreateUser] confirmação de vínculo não preparada:', {
            requestId: routeRequestId,
            source,
            patientId,
            email: maskEmail(normalizedEmail),
            message: sanitizeString(confirmation.error?.message || String(confirmation.error), 180)
          });
        }

        void persistActivityLog({
          userId: sanitizeString(req.session.user?.id, 120),
          clinicId: safeClinicId,
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuario', 180),
          title: 'Confirmação de vínculo enviada',
          content: 'Solicitação de novo vínculo foi enviada sem expor histórico anterior.',
          type: 'management',
          actionType: 'RELATIONSHIP_CONFIRMATION_SENT',
          payload: {
            patientId,
            email: maskEmail(normalizedEmail),
            sent: Boolean(confirmation.sent)
          }
        });

        return {
          sent: Boolean(confirmation.sent),
          confirmationId: confirmation.confirmationId || null,
          reason: confirmation.success ? null : 'Não foi possível enviar a confirmação agora.'
        };
      };

      // 1. Check if user already exists in 'users' table
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('id')
        .eq('email', normalizedEmail)
        .limit(1)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingUser) {
        // E-mail de paciente pode existir em outra clínica para outra especialidade
        // ou pertencer a uma identidade profissional. O novo contexto de paciente
        // fica no vínculo e nunca substitui o papel global da conta existente.
        const linkedPatientId = await ensurePatientLink(existingUser.id, { existingAccount: true });
        const relationshipConfirmation = await sendRelationshipConfirmationForLinkedPatient(
          existingUser.id,
          linkedPatientId,
          'existing_public_user'
        );
        if (isUuid(safeClinicId)) {
          queueActivePatientSync(safeClinicId, 'patient_create_user_existing');
        }
        void persistActivityLog({
          userId: sanitizeString(req.session.user?.id, 120),
          clinicId: safeClinicId,
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuario', 180),
          title: 'Responsável existente vinculado ao paciente',
          content: 'Responsável existente foi vinculado a paciente da clínica atual.',
          type: 'management',
          actionType: 'RESPONSIBLE_LINKED_TO_NEW_PATIENT',
          payload: {
            email: maskEmail(normalizedEmail),
            userAlreadyExisted: true,
            portabilityAvailable: true
          }
        });
        return res.json({
          success: true,
          idempotent: true,
          status: 'RELATIONSHIP_CONFIRMATION_SENT',
          code: 'RELATIONSHIP_CONFIRMATION_SENT',
          legacyStatus: 'LINKED_EXISTING_USER',
          message: relationshipConfirmation.sent
            ? 'Confirmação de vínculo enviada para o responsável.'
            : 'Vínculo pendente criado. Reenvie a confirmação de vínculo quando necessário.',
          warning: null,
          activationEmailSent: false,
          relationshipConfirmationSent: relationshipConfirmation.sent,
          patientId: linkedPatientId,
          portabilityAvailable: true,
          userAlreadyExisted: true
        });
      }

      // 2. Create user in Supabase Auth (Admin API)
      // Cadastro orientado por ativação via e-mail: senha será definida no link de ativação
      const generatedPassword = `${crypto.randomBytes(10).toString('hex')}V!a9`;
      
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: generatedPassword,
        email_confirm: false,
        user_metadata: {
          full_name: safeName,
          role: 'patient',
          type: normalizedPortalType,
          clinic_id: isUuid(safeClinicId) ? safeClinicId : null,
          invited_email: normalizedEmail,
          patient_activation_required: true,
          first_login_completed: false
        }
      });

      if (authError) {
        // If user already exists in Auth but not in our public users table, resolve as a safe link instead of returning 500.
        if (isAuthEmailAlreadyRegisteredError(authError)) {
          let foundUser: any | null = null;
          try {
            foundUser = await findAuthUserByEmailForPatientCreate(normalizedEmail);
          } catch (lookupError: any) {
            console.warn('[PatientCreateUser] auth duplicate lookup warning:', {
              email: maskEmail(normalizedEmail),
              code: sanitizeString(lookupError?.code, 40) || null,
              message: sanitizeString(lookupError?.message || String(lookupError), 180)
            });
          }

          if (foundUser?.id) {
            const linkedPatientId = await ensurePatientLink(foundUser.id, { existingAccount: true });
            const relationshipConfirmation = await sendRelationshipConfirmationForLinkedPatient(
              foundUser.id,
              linkedPatientId,
              'auth_duplicate_resolved'
            );
            if (isUuid(safeClinicId)) {
              queueActivePatientSync(safeClinicId, 'patient_create_user_auth_exists');
            }
            void persistActivityLog({
              userId: sanitizeString(req.session.user?.id, 120),
              clinicId: safeClinicId,
              actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuario', 180),
              title: 'Acesso existente vinculado',
              content: 'Acesso existente foi vinculado sem criar uma nova identidade global.',
              type: 'management',
              actionType: 'EXISTING_EMAIL_LINKED',
              payload: {
                email: maskEmail(normalizedEmail),
                source: 'auth_user_exists',
                portabilityAvailable: true
              }
            });
            return res.json({
              success: true,
              idempotent: true,
              status: 'RELATIONSHIP_CONFIRMATION_SENT',
              code: 'RELATIONSHIP_CONFIRMATION_SENT',
              legacyStatus: 'LINKED_EXISTING_USER',
              message: relationshipConfirmation.sent
                ? 'Confirmação de vínculo enviada para o responsável.'
                : 'Vínculo pendente criado. Reenvie a confirmação de vínculo quando necessário.',
              warning: null,
              activationEmailSent: false,
              relationshipConfirmationSent: relationshipConfirmation.sent,
              patientId: linkedPatientId,
              portabilityAvailable: true,
              userAlreadyExisted: true
            });
          }

          return res.status(409).json({
            success: false,
            status: 'CONFLICT_REQUIRES_REVIEW',
            code: 'CONFLICT_REQUIRES_REVIEW',
            error: 'Não foi possível confirmar este vínculo automaticamente.'
          });
        }
        throw authError;
      }

      if (authUser?.user) {
        await upsertPatientProfile(authUser.user.id);
        const linkedPatientId = await ensurePatientLink(authUser.user.id, { existingAccount: false });
        await updatePatientInviteStatus(authUser.user.id, 'INVITE_QUEUED');
        if (isUuid(safeClinicId)) {
          queueActivePatientSync(safeClinicId, 'patient_create_user_new');
        }
        sendPatientInviteInBackground({ context: 'new_patient_user', authUserId: authUser.user.id });

        return res.json({
          success: true,
          status: 'INVITE_QUEUED',
          message: 'Convite preparado com sucesso.',
          warning: null,
          activationEmailSent: null,
          relationshipConfirmationSent: false,
          patientId: linkedPatientId,
          portabilityAvailable: false
        });
      }

      res.status(500).json({ success: false, message: 'Não foi possível preparar o convite agora.' });
    } catch (error: any) {
      const normalizedEmailForLog = sanitizeEmail(req.body?.email) || '';
      console.error('Error creating patient user:', {
        email: maskEmail(normalizedEmailForLog),
        code: sanitizeString(error?.code, 40) || null,
        message: sanitizeString(error?.message || String(error), 220)
      });

      const errorMessage = String(error?.message || error || '');
      const errorCode = sanitizeString(error?.code, 40);
      const looksLikeExpectedDuplicate =
        isDuplicateConstraintError(error) ||
        isAuthEmailAlreadyRegisteredError(error) ||
        /already\s+(registered|exists)|duplicate.*email|email.*already/i.test(errorMessage);

      if (looksLikeExpectedDuplicate) {
        return res.status(409).json({
          success: false,
          status: 'CONFLICT_REQUIRES_REVIEW',
          code: 'CONFLICT_REQUIRES_REVIEW',
          error: 'Não foi possível confirmar este vínculo automaticamente.'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Não foi possível preparar o convite agora.'
      });
    }
  };
}
