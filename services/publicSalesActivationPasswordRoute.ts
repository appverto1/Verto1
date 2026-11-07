import type { Express, RequestHandler } from 'express';

// All paid-offer, Director identity, clinic and single-use activation checks
// remain in the original handler below. The dependencies are explicitly
// injected by the server; the browser cannot select any of them.
export interface PublicSalesActivationPasswordRouteDeps {
  supabase: any;
  publicSalesActivationLimiter: RequestHandler;
  validateStrongPassword: (value: unknown) => string | null;
  loadPublicSalesActivation: (rawToken: unknown) => Promise<any>;
  findAuthUserByEmail: (email: string) => Promise<any>;
  fetchProfileWithSchemaFallback: (params: any) => Promise<any>;
  insertUserProfileWithSchemaFallback: (params: any) => Promise<any>;
  extractMissingColumnName: (error: any) => string | null;
  cleanObject: (input: any) => any;
  ensureClinicAndMembershipForCoordinator: (userId: string, role: string) => Promise<any>;
  finalizeSalesActivationForUser: (params: any) => Promise<any>;
  maskEmail: (email: unknown) => string;
  sanitizeEmail: (email: unknown) => string | null;
  sanitizeString: (value: unknown, maxLength?: number) => string;
}

export function registerPublicSalesActivationPasswordRoute(
  app: Express, deps: PublicSalesActivationPasswordRouteDeps,
): void {
  const {
    supabase, publicSalesActivationLimiter, validateStrongPassword,
    loadPublicSalesActivation, findAuthUserByEmail,
    fetchProfileWithSchemaFallback, insertUserProfileWithSchemaFallback,
    extractMissingColumnName, cleanObject, ensureClinicAndMembershipForCoordinator,
    finalizeSalesActivationForUser, maskEmail, sanitizeEmail, sanitizeString,
  } = deps;

  app.post(
    "/api/public/sales-activations/:token/password",
    publicSalesActivationLimiter,
    async (req: any, res) => {
      if (Buffer.byteLength(JSON.stringify(req.body || {}), "utf8") > 4096) {
        return res.status(413).json({
          success: false,
          error: "PAYLOAD_TOO_LARGE",
          message: "Os dados enviados excedem o limite permitido.",
        });
      }
      const password = validateStrongPassword(req.body?.password);
      if (!password) {
        return res.status(400).json({
          success: false,
          error: "WEAK_PASSWORD",
          message:
            "Use uma senha de 12 a 128 caracteres, com maiúscula, minúscula, número e símbolo.",
        });
      }

      let passwordSaved = false;
      try {
        const loaded = await loadPublicSalesActivation(req.params?.token);
        if ("error" in loaded) {
          const expired = loaded.error === "SALES_ACTIVATION_EXPIRED";
          return res.status(expired ? 410 : 404).json({
            success: false,
            error: loaded.error,
            message: expired
              ? "Este link de ativação expirou. Solicite um novo link à equipe da Verto."
              : "Este link de ativação não está disponível.",
          });
        }

        let authUser = await findAuthUserByEmail(loaded.email);
        if (authUser?.id) {
          const existingProfileResult = await fetchProfileWithSchemaFallback({
            supabase,
            userId: authUser.id,
            logger: console,
          });
          if (existingProfileResult.error) throw existingProfileResult.error;
          if (existingProfileResult.data) {
            const existingProfile = existingProfileResult.data as any;
            const activationOfferId = sanitizeString(
              authUser?.user_metadata?.sales_activation_offer_id,
              120,
            );
            const profileEmail = sanitizeEmail(existingProfile?.email);
            const profileRole = sanitizeString(existingProfile?.role, 40).toLowerCase();
            const profileClinicId = sanitizeString(existingProfile?.clinic_id, 120);
            const recoverablePartialActivation =
              activationOfferId === loaded.offerId &&
              profileEmail === loaded.email &&
              ["director", "coordinator"].includes(profileRole) &&
              (!profileClinicId || profileClinicId === authUser.id) &&
              loaded.activation.used !== true;

            if (!recoverablePartialActivation) {
              return res.status(409).json({
                success: false,
                error: "ACCOUNT_ALREADY_ACTIVE",
                message:
                  "Esta conta já possui acesso à Verto. Entre normalmente ou recupere sua senha.",
              });
            }

            console.warn(
              "[Sales Activation] Retomando ativação parcial após provisionamento interrompido:",
              {
                email: maskEmail(loaded.email),
                userId: sanitizeString(authUser.id, 120),
                offerId: loaded.offerId,
              },
            );
          }

          const { data: updatedUser, error: updateError } =
            await supabase.auth.admin.updateUserById(authUser.id, {
              password,
              email_confirm: true,
              user_metadata: {
                ...(authUser.user_metadata || {}),
                full_name:
                  sanitizeString(loaded.lead.name, 180) ||
                  loaded.email.split("@")[0],
                sales_activation_offer_id: loaded.offerId,
              },
            });
          if (updateError) throw updateError;
          authUser = updatedUser?.user || authUser;
        } else {
          const { data: createdUser, error: createError } =
            await supabase.auth.admin.createUser({
              email: loaded.email,
              password,
              email_confirm: true,
              user_metadata: {
                full_name:
                  sanitizeString(loaded.lead.name, 180) ||
                  loaded.email.split("@")[0],
                sales_activation_offer_id: loaded.offerId,
              },
            });
          if (createError) {
            const normalizedError = sanitizeString(
              createError.message,
              240,
            ).toLowerCase();
            if (normalizedError.includes("already")) {
              authUser = await findAuthUserByEmail(loaded.email);
              if (!authUser?.id) throw createError;
              const { error: retryUpdateError } =
                await supabase.auth.admin.updateUserById(authUser.id, {
                  password,
                  email_confirm: true,
                });
              if (retryUpdateError) throw retryUpdateError;
            } else {
              throw createError;
            }
          } else {
            authUser = createdUser?.user || null;
          }
        }

        if (!authUser?.id) throw new Error("SALES_AUTH_USER_NOT_CREATED");
        passwordSaved = true;

        // The person who contracts a new clinic is its initial director. Finish
        // the commercial provisioning here, while the activation token is still
        // authoritative, instead of leaving half of the operation to /auth/login.
        // This makes retries deterministic: Auth may already exist, but the same
        // offer/token can safely resume until the workspace is fully provisioned.
        const ownerName =
          sanitizeString(loaded.lead.name, 180) || loaded.email.split("@")[0];
        const ownerProfileResult = await fetchProfileWithSchemaFallback({
          supabase,
          userId: authUser.id,
          logger: console,
        });
        if (ownerProfileResult.error) throw ownerProfileResult.error;

        if (ownerProfileResult.data) {
          const existingOwnerProfile = ownerProfileResult.data as any;
          if (
            sanitizeEmail(existingOwnerProfile.email) !== loaded.email ||
            (sanitizeString(existingOwnerProfile.clinic_id, 120) &&
              sanitizeString(existingOwnerProfile.clinic_id, 120) !== authUser.id)
          ) {
            const ownershipMismatch = new Error("SALES_ACTIVATION_PROFILE_SCOPE_MISMATCH");
            (ownershipMismatch as any).code = "SALES_ACTIVATION_PROFILE_SCOPE_MISMATCH";
            throw ownershipMismatch;
          }

          let ownerProfileUpdates: Record<string, any> = cleanObject({
            email: loaded.email,
            name: ownerName,
            role: "director",
            clinic_id: authUser.id,
            subscription_status: "active",
            first_login_completed: false,
            updated_at: new Date().toISOString(),
          });
          while (Object.keys(ownerProfileUpdates).length > 0) {
            const ownerProfileUpdate = await supabase
              .from("users")
              .update(ownerProfileUpdates)
              .eq("id", authUser.id);
            if (!ownerProfileUpdate.error) break;
            const missingColumn = extractMissingColumnName(ownerProfileUpdate.error);
            if (
              missingColumn &&
              missingColumn in ownerProfileUpdates &&
              !["email", "name", "role", "clinic_id"].includes(missingColumn)
            ) {
              delete ownerProfileUpdates[missingColumn];
              continue;
            }
            throw ownerProfileUpdate.error;
          }
        } else {
          const ownerProfileInsert = await insertUserProfileWithSchemaFallback({
            id: authUser.id,
            email: loaded.email,
            name: ownerName,
            role: "director",
            clinic_id: authUser.id,
            subscription_status: "active",
            first_login_completed: false,
            created_at: new Date().toISOString(),
          });
          if (ownerProfileInsert.error) throw ownerProfileInsert.error;
        }

        await ensureClinicAndMembershipForCoordinator(authUser.id, "director");
        const [ownedClinicCheck, directorMembershipCheck] = await Promise.all([
          supabase.from("clinics").select("id").eq("id", authUser.id).maybeSingle(),
          supabase
            .from("clinic_memberships")
            .select("user_id,clinic_id,role,status")
            .eq("user_id", authUser.id)
            .eq("clinic_id", authUser.id)
            .eq("status", "active")
            .maybeSingle(),
        ]);
        if (
          ownedClinicCheck.error ||
          !ownedClinicCheck.data ||
          directorMembershipCheck.error ||
          !directorMembershipCheck.data ||
          sanitizeString((directorMembershipCheck.data as any).role, 40) !== "director"
        ) {
          const workspaceError = new Error("SALES_ACTIVATION_WORKSPACE_PROVISIONING_FAILED");
          (workspaceError as any).code = "SALES_ACTIVATION_WORKSPACE_PROVISIONING_FAILED";
          throw workspaceError;
        }

        await finalizeSalesActivationForUser({
          email: loaded.email,
          userId: authUser.id,
          clinicId: authUser.id,
          offerId: loaded.offerId,
          leadId: loaded.leadId,
          checkoutSessionId: loaded.checkoutSessionId,
        });

        const { error: ownerMetadataError } = await supabase.auth.admin.updateUserById(
          authUser.id,
          {
            user_metadata: {
              ...(authUser.user_metadata || {}),
              full_name: ownerName,
              sales_activation_offer_id: loaded.offerId,
              first_login_completed: false,
            },
          },
        );
        if (ownerMetadataError) throw ownerMetadataError;

        return res.json({
          success: true,
          passwordSaved: true,
          email: loaded.email,
          role: "director",
          modules: loaded.contractedModules || [],
          message: "Senha definida. Seu acesso de Diretor está pronto com os módulos contratados.",
        });
      } catch (error: any) {
        console.error(
          "[Sales Activation] Falha ao preparar acesso por senha:",
          {
            message: sanitizeString(error?.message || String(error), 240),
          },
        );
        const safeCode = sanitizeString(error?.code || error?.message, 120);
        const provisioningFailure = [
          "MODULE_ENTITLEMENT_PROVISIONING_FAILED",
          "SALES_ACTIVATION_WORKSPACE_PROVISIONING_FAILED",
          "SALES_SUBSCRIPTION_LINKAGE_MISSING",
          "SALES_SUBSCRIPTION_NOT_ACTIVE",
          "SALES_DIRECTOR_ENTITLEMENT_VERIFICATION_FAILED",
        ].includes(safeCode);
        return res.status(provisioningFailure ? 503 : 500).json({
          success: false,
          passwordSaved,
          error: provisioningFailure
            ? "SALES_ACTIVATION_PROVISIONING_FAILED"
            : "SALES_ACTIVATION_SETUP_FAILED",
          message: passwordSaved
            ? "Sua senha foi salva, mas a liberação do acesso de Diretor ainda não terminou. Tente novamente para concluir sem criar outra conta."
            : "Não foi possível concluir a ativação agora. Tente novamente; nenhum acesso será duplicado.",
        });
      }
    },
  );

}

// The handler body above is byte-identical to the pre-extraction staging source.
