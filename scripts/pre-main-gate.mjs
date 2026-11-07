import { spawnSync } from 'node:child_process';
import {validateCandidateManifest} from './factory-recovery-controls.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const failures = [];
const passes = [];

const pass = (label) => passes.push(label);
const fail = (label, detail = '') => failures.push({ label, detail });

// Contract v3 #267: gate scope comes from the committed contract template; facts come from Git.
const factoryCatalog=JSON.parse(readFileSync(join(root,'docs/factory/BLOCKER_CATALOG_V1.json'),'utf8'));
const template=factoryCatalog.contract_manifest;
if(template?.contract_version===3&&(process.env.GITHUB_REF_NAME===template.branch||spawnSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).stdout.trim()===template.branch)){
  const git=args=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(result.status!==0)throw new Error(`manifest Git read failed: ${args[0]}`);return result.stdout;};
  try{
    const head=git(['rev-parse','HEAD']).trim(),tree=git(['rev-parse','HEAD^{tree}']).trim(),staging=git(['rev-parse','origin/staging']).trim();
    if(staging!==template.base_sha)throw new Error('manifest baseline differs from factual staging');
    if(process.env.GITHUB_SHA&&process.env.GITHUB_SHA!==head)throw new Error('manifest candidate differs from exact runner SHA');
    const entries=new Map(git(['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean).map(line=>{const at=line.indexOf('\t'),[mode,,blob_sha]=line.slice(0,at).split(' ');return [line.slice(at+1),{mode,blob_sha}];}));
    const changed=git(['diff','--name-status','--no-renames','-z',template.base_sha,'HEAD']).split('\0').filter(Boolean),paths=[];
    for(let index=0;index<changed.length;index+=2){
      const status={A:'added',M:'modified',D:'removed'}[changed[index]],path=changed[index+1];
      if(!status||!path)throw new Error('invalid factual changed-path entry');
      paths.push({path,status,...(status==='removed'?{mode:null,blob_sha:null}:entries.get(path))});
    }
    const manifest={schema_version:'FACTORY_CANDIDATE_MANIFEST_V1',issue:267,contract_version:3,branch:template.branch,base_sha:staging,head_sha:head,tree_sha:tree,paths};
    const result=validateCandidateManifest(manifest,manifest,template.authorized_paths);
    if(!result.valid)throw new Error(JSON.stringify(result.problems));
    console.log('[factory-candidate-manifest] '+JSON.stringify(manifest));
    pass('Factory contract v3 factual SHA/tree/path manifest');
  }catch(error){fail('Factory contract v3 factual SHA/tree/path manifest',String(error.message));}
}

const requireFile = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    fail(`arquivo obrigatório: ${path}`, 'não encontrado');
    return null;
  }
  pass(`arquivo obrigatório: ${path}`);
  return readFileSync(absolute, 'utf8');
};

const dockerRuntimeCheck = spawnSync(process.execPath, ['scripts/check-docker-runtime-imports.mjs'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 20_000,
  env: { ...process.env, NODE_ENV: 'test' },
});
if (dockerRuntimeCheck.stdout) process.stdout.write(dockerRuntimeCheck.stdout);
if (dockerRuntimeCheck.stderr) process.stderr.write(dockerRuntimeCheck.stderr);
if (dockerRuntimeCheck.status === 0) {
  pass('Docker runner contém toda a árvore de imports server-side');
} else {
  fail(
    'Docker runner contém toda a árvore de imports server-side',
    String(dockerRuntimeCheck.stderr || dockerRuntimeCheck.stdout || `status=${dockerRuntimeCheck.status}`).trim().slice(0, 1200),
  );
}

const requiredMigrations = [
  'supabase/migrations/20260826143000_pts_document_lineage_events_v2.sql',
  'supabase/migrations/20260826152500_therapeutic_plan_rebac_hierarchy_v1.sql',
  'supabase/migrations/20260826154500_specialty_session_pts_context_binding_v1.sql',
  'supabase/migrations/20260826174500_clinic_canonical_timezone_v1.sql',
  'supabase/migrations/20260826183000_patient_case_team_coordinator_authority_v2.sql',
  'supabase/migrations/20260826190000_pts_draft_persistence_activation_v3.sql',
  'supabase/migrations/20260826200000_patient_case_team_manager_removal_v3.sql',
  'supabase/migrations/20260826211500_patient_primary_pointer_nullable_v1.sql',
];

for (const migrationPath of requiredMigrations) {
  const sql = requireFile(migrationPath);
  if (!sql) continue;
  if (!/\bbegin\s*;/i.test(sql) || !/\bcommit\s*;/i.test(sql)) {
    fail(`transação SQL: ${migrationPath}`, 'migration sem BEGIN/COMMIT explícitos');
  } else {
    pass(`transação SQL: ${migrationPath}`);
  }
  const malformedComment = sql.split(/\r?\n/).find((line) => /^\s*-[^-]/.test(line));
  if (malformedComment) {
    fail(`comentários SQL: ${migrationPath}`, `linha inválida: ${malformedComment.trim()}`);
  } else {
    pass(`comentários SQL: ${migrationPath}`);
  }
}

const rebacMigration = readFileSync(join(root, requiredMigrations[1]), 'utf8');
if (/create or replace function public\.therapeutic_patient_actor_has_link_permission_v1\s*\(/i.test(rebacMigration)) {
  pass('ReBAC migration autossuficiente');
} else {
  fail('ReBAC migration autossuficiente', 'helper therapeutic_patient_actor_has_link_permission_v1 ausente');
}

const removalMigration = readFileSync(join(root, requiredMigrations[6]), 'utf8');
for (const contract of [
  'patient_case_team_actor_can_manage_v1',
  'end_patient_professional_link_v1',
  'PATIENT_PROFESSIONAL_LINK_PROTECTED_CLINIC_MANAGER',
]) {
  if (removalMigration.includes(contract)) pass(`case-team contract: ${contract}`);
  else fail(`case-team contract: ${contract}`, 'ausente na migration corretiva final');
}

const primaryPointerMigration = readFileSync(join(root, requiredMigrations[7]), 'utf8');
if (/alter\s+column\s+therapist_id\s+drop\s+not\s+null/i.test(primaryPointerMigration)) {
  pass('legacy patients.therapist_id permite ausência de responsável primário');
} else {
  fail(
    'legacy patients.therapist_id permite ausência de responsável primário',
    'migration não remove NOT NULL de patients.therapist_id',
  );
}

const railway = JSON.parse(readFileSync(join(root, 'railway.json'), 'utf8'));
if (railway?.deploy?.healthcheckPath === '/api/ready') {
  pass('Railway usa /api/ready');
} else {
  fail('Railway usa /api/ready', `healthcheckPath=${railway?.deploy?.healthcheckPath ?? 'ausente'}`);
}

const server = readFileSync(join(root, 'server.ts'), 'utf8');
if (server.includes("app.get('/api/ready'")) pass('endpoint /api/ready existe');
else fail('endpoint /api/ready existe');
if (server.includes("app.get('/api/health'")) pass('endpoint /api/health existe');
else fail('endpoint /api/health existe');

const envValidator = readFileSync(join(root, 'scripts/validate-required-env.mjs'), 'utf8');
if (envValidator.includes('SUPABASE_EXPECTED_PROJECT_REF')) pass('proteção contra Supabase errado no deploy');
else fail('proteção contra Supabase errado no deploy');

const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
if (/FROM node:20-/i.test(dockerfile) && /RUN npm ci\b/.test(dockerfile)) {
  pass('Docker build determinístico com Node 20 + npm ci');
} else {
  fail('Docker build determinístico com Node 20 + npm ci');
}

const sourceExtensions = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sql|html)$/i;
const ignoredDirs = new Set(['node_modules', 'dist', '.git']);
const secretPatterns = [
  ['Stripe secret', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{12,}/g],
  ['Supabase/JWT token', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
  ['Postgres credential URL', /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/gi],
];

const walk = (dir, callback) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, callback);
    else if (entry.isFile()) callback(full);
  }
};

const secretHits = [];
walk(root, (file) => {
  if (!sourceExtensions.test(file) || file.endsWith('package-lock.json')) return;
  let content = '';
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) secretHits.push(`${label}: ${relative(root, file)}`);
  }
});
if (secretHits.length === 0) pass('nenhum secret óbvio versionado');
else fail('nenhum secret óbvio versionado', secretHits.join('; '));

const criticalTests = [
  'tests/salesWebsiteInterestKanban.regression.test.mjs',
  'tests/salesKanbanOpportunityCreationExtraction.regression.test.mjs',
  'tests/salesKanbanManualCreationIdentitySmoke02.regression.test.mjs',
  'tests/salesKanbanOpportunityCreationRoutes.test.ts',
  'tests/salesKanbanOpportunityCreationInput.test.ts',
  'tests/salesKanbanOpportunityCreationTransport.test.ts',
  'tests/salesProspectingActivityExtraction.regression.test.mjs',
  'tests/salesKanbanActivityInput.test.ts',
  'tests/salesProspectingKanban.regression.test.mjs',
  'tests/salesKanbanMovementBehavior.test.ts',
  'tests/salesProspectingActivityBehavior.test.ts',
  'tests/salesKanbanActivityTransport.test.ts',
  'tests/salesModularProposalPersistence.test.ts',
  'tests/salesModularProposalBuilderInput.test.ts',
  'tests/salesModularProposalSnapshotBoundary.regression.test.mjs',
  'tests/salesPublicOfferLinks.test.ts',
  'tests/salesPublicOfferContractIdentity.test.ts',
  'tests/salesPublicOfferHistoryIsolation.regression.test.mjs',
  'tests/publicSalesOfferTransport.test.ts',
  'tests/publicSalesOfferAccessIsolation.regression.test.mjs',
  'tests/publicSalesOfferPresentationModularization.regression.test.mjs',
  'tests/salesPublicCardCheckoutTransport.test.ts',
  'tests/salesPublicCardCheckoutInitiation.test.ts',
  'tests/salesPublicCardCheckoutSafety.regression.test.mjs',
  'tests/salesBoletoPaymentPendingSafety.regression.test.mjs',
  'tests/salesPublicPostPaymentTransport.test.ts',
  'tests/salesPublicPaymentStatusRoute.test.ts',
  'tests/salesStripeWebhookDbMonotonicGuard.regression.test.mjs',
  'tests/legacySalesActivationStripeWebhookRoute.test.ts',
  'tests/salesAssistedStripeEventHandlers.test.ts',
  'tests/stripeCanonicalWebhookRoute.test.ts',
  'tests/salesStripeWebhookLeadStateIsolation.regression.test.mjs',
  'tests/salesPaidDirectorDirectOnboardingTask10.regression.test.mjs',
  'tests/publicSalesDirectorSession.test.ts',
  'tests/publicSalesDirectorSessionRoute.test.ts',
  'tests/salesActivationPasswordFirstAccess.test.mjs',
  'tests/salesActivationPasswordProviderAgnostic.test.mjs',
  'tests/salesActivationPartialRecovery.test.ts',
  'tests/salesDirectorEmailPasswordFirstAccessTask11.regression.test.mjs',
  'tests/salesActivationPasswordTransport.test.ts',
  'tests/salesActivationPasswordRules.test.ts',
  'tests/salesActivationPasswordRoute.test.ts',
  'tests/salesDirectorGoogleFirstAccessTask12.regression.test.mjs',
  'tests/salesActivationGoogleOAuth.test.ts',
  'tests/clinicSettingsConfirmedSaveTask13.regression.test.mjs',
  'tests/confirmedClinicSettingsSave.test.ts',
  'tests/guidedFirstAccessRolePersistenceTask14.regression.test.mjs',
  'tests/contextualGuidedTutorialP0.regression.test.mjs',
  'tests/googleOauthActivationUi.regression.test.mjs',
  'tests/authStateChangeDeadlockRegression.test.mjs',
  'tests/salesStripeWebhookDbMonotonicGuard.behavior.test.mjs',
  'tests/salesInterestSubmission.contract.test.mjs',
  'tests/salesInterestSubmission.behavior.test.ts',
  'tests/publicSalesLeadRouteExtraction.regression.test.mjs',
  'tests/publicSalesLeadRouteBehavior.test.ts',
  'tests/publicSalesLeadInput.behavior.test.ts',
  'tests/productionPaidOfferAccessRecovery.regression.test.mjs',
  'tests/factoryRecoveryControls.regression.test.mjs',
  'tests/factoryAuthorizedTarget.regression.test.mjs',
  'tests/factoryPostMergeConsistency.regression.test.mjs',
  'tests/factoryBlockerCatalog.regression.test.mjs',
  'tests/security.regression.test.mjs',
  'tests/patientFileActorJwtBinding.regression.test.mjs',
  'tests/patientSharedChartGovernanceP0.regression.test.mjs',
  'tests/patientSharedChartPatientSwitchIsolation.test.mjs',
  'tests/patientSharedChartDelegationHttp.test.ts',
  'tests/goLiveHardening.test.mjs',
  'tests/distributedSessionSafety.regression.test.mjs',
  'tests/productionSessionPersistence.regression.test.mjs',
  'tests/healthRouteHandler.test.ts',
  'tests/internalSchemaStatusRouteHandler.test.ts',
  'tests/backgroundWorkerEconomyMode.test.ts',
  'tests/pushSubscriptionInvalidation.test.ts',
  'tests/patientNotificationPushPresentation.test.mjs',
  'tests/patientPushPriorityAndTiming.test.ts',
  'tests/clinicPolicyPayloadHash.test.ts',
  'tests/supabaseSchemaSelectGuard.test.ts',
  'tests/therapeuticPlanHierarchyRebac.regression.test.mjs',
  'tests/therapeuticPlanCaseProfessionalCapability.regression.test.ts',
  'tests/therapeuticPlanSessionContext.regression.test.mjs',
  'tests/sessionSpecialtyIsolation.test.ts',
  'tests/p0504SessionContinuationPolicy.test.ts',
  'tests/p0504ContinuationPreviewRoutes.test.ts',
  'tests/clinicSchedulingActiveMembership.regression.test.mjs',
  'tests/calendarPatientIdentitySharedRoom.regression.test.ts',
  'tests/abaMeasurementV3CollectionUi.test.mjs',
  'tests/patientCaseTeamCoordinatorAuthority.regression.test.mjs',
  'tests/p0CaseTeamModalViewport.regression.test.mjs',
  'tests/p0CaseTeamEligibleRefresh.regression.test.mjs',
  'tests/patientCaseTeamManagerRemoval.regression.test.mjs',
  'tests/patientCaseTeamPrimaryPointerNullable.regression.test.mjs',
  'tests/patientCaseTeamSchemaDriftRecovery.test.mjs',
  'tests/ptsDraftPersistenceActivation.regression.test.mjs',
  'tests/ptsLegacyEvidenceBoundary.regression.test.mjs',
  'tests/ptsTherapeuticDashboard.test.mjs',
  'tests/clinicCanonicalTimeZone.regression.test.mjs',
  'tests/abaSessionClinicalDateTimezone.regression.test.mjs',
  'tests/abaReinforcersRuntime.regression.test.mjs',
  'tests/sessionCompletionMissingSessionRecovery.regression.test.mjs',
  'tests/sessionLifecycleRecovery.regression.test.mjs',
  'tests/sessionAutoFinalization.regression.test.mjs',
  'tests/sessionOfflineLifecycleP0.regression.test.mjs',
  'tests/clinicalMeasurementV3RouteModularization.regression.test.mjs',
  'tests/patientDirectoryOrdering.regression.test.mjs',
  'tests/progressReportFilters.regression.test.mjs',
  'tests/anamnesisSavePersistenceConfirmation.regression.test.mjs',
  'tests/anamnesisPortalReadOnlyStatus.regression.test.mjs',
  'tests/anamnesisProfessionalCapability.regression.test.mjs',
  'tests/authorizationRoleMatrixE2E.regression.test.ts',
  'tests/supervisorPatientScopeE2E.regression.test.mjs',
  'tests/clinicalGraphRoleScopeP0.regression.test.ts',
  'tests/existingProfessionalInAppInvitation.test.mjs',
  'tests/clinicReinviteAccess.test.ts',
  'tests/teamManagementTenantRefresh.regression.test.mjs',
  'tests/clinicInvitationSubmissionGate.regression.test.mjs',
  'tests/patientSelfTenantIsolation.regression.test.mjs',
  'tests/sessionExpiredCleanLogout.regression.test.mjs',
  'tests/patientTaskCompletionIdempotency.regression.test.mjs',
  'tests/p0WellbeingProductionReconciliation.regression.test.mjs',
  'tests/agendaPortalActionsP0.regression.test.mjs',
  'tests/p0ContextAuthAgendaBatch05.test.ts',
  'tests/schedulingOverlappingRoomsPatientIdentity.test.ts',
  'tests/critical22RecurringAppointmentCadence.test.ts',
  'tests/appointmentCancellationReasons.test.ts',
  'tests/groupSessionRules.test.ts',
  'tests/groupFinancialPlanPrice.test.ts',
  'tests/groupFinancialPlanPersistence.test.ts',
  'tests/groupScheduleConflict.test.ts',
  'tests/groupSessionWriteValidation.test.ts',
  'tests/groupSessionFinancialValidation.test.ts',
  'tests/groupSessionPricePreview.test.ts',
  'tests/groupSessionPricePreviewRoute.test.ts',
  'tests/groupFinancialPlanFormAndAuthority.test.ts',
  'tests/groupSessionBookingPlan.test.ts',
  'tests/groupSessionResourceValidation.test.ts',
  'tests/groupSessionBookingPreview.test.ts',
  'tests/groupSessionAvailability.test.ts',
  'tests/groupSessionBookingLedgerSql.test.mjs',
  'tests/groupSessionTransactionalSlotGuards.test.mjs',
  'tests/groupSessionBookingPreviewRoute.test.ts',
  'tests/groupSessionFinancialRateRoutes.test.ts',
  'tests/groupSessionFinancialCapabilityGuard.test.ts',
  'tests/groupSessionFinanceAtomicSql.test.ts',
  'tests/p0BackendAppointmentFinalization.test.ts',
  'tests/p0AppointmentReminderClaimIntegrity.test.ts',
  'tests/abaLegacyProtocolApplicationsP0.regression.test.mjs',
  'tests/receptionAuthorizationFirstRender.regression.test.mjs',
  'tests/familyDiaryPersistence.regression.test.mjs',
  'tests/familyDiarySaveAck.regression.test.mjs',
  'tests/abaLegacyAssessmentEvidence.regression.test.mjs',
  'tests/clinicalPlanAnalyticsShell.regression.test.mjs',
  'tests/clinicalOutcomePlanScope.regression.test.ts',
  'tests/p1ClinicalChartHydration.regression.test.mjs',
  'tests/p1AdultChartsSessionFinancial.regression.test.mjs',
  'tests/p000PediatricAnamnesisSnapshot.regression.test.mjs',
  'tests/p000PatientProfilePartialPatch.regression.test.mjs',
  'tests/p0HelpNavigationSearch.test.ts',
  'tests/p0HelpRoleProgressContract.test.ts',
  'tests/helpTutorialSupport.test.ts',
  'tests/patientTimeReportRoute.test.ts',
  'tests/abaV3DrainStatusHandler.test.ts',
  'tests/p3PtsBackNavigationHeader.regression.test.mjs',
  'tests/p3SingleProfessionalTransferAction.regression.test.mjs',
  'tests/p3PatientTaskOverdueBadge.regression.test.mjs',
  'tests/p3PatientTaskModalViewport.regression.test.mjs',
  'tests/p3PatientFileImagePreviewFit.regression.test.mjs',
  'tests/p3PatientProfileMenuConsolidation.regression.test.mjs',
  'tests/p3AnamnesisDraftRestoreModal.regression.test.mjs',
  'tests/p3OnboardingAvailabilityGuidance.regression.test.mjs',
  'tests/p1AgendaReceptionRoomStatus.regression.test.mjs',
  'tests/p1PortalRescheduleConfiguredWeekdays.regression.test.ts',
  'tests/p1PortalRescheduleEmptyWeekMap.regression.test.ts',
  'tests/p000PediatricSessionRoute.regression.test.mjs',
  'tests/p000PatientCategoryPersistence.regression.test.mjs',
  'tests/p000PediatricTargetCollection.regression.test.mjs',
  'tests/p000PtsActivationOptionalAndCas.regression.test.mjs',
  'tests/critical20TherapeuticPlanAck.regression.test.mjs',
  'tests/p1AdultClinicalFinancialScopes.regression.test.mjs',
  'tests/clinicalPlanAnalyticsSessionNavigation.regression.test.mjs',
  'tests/planPtsSessionGraphIntegrationP0.regression.test.mjs',
  'tests/contextualGuidedTutorialP0.regression.test.mjs',
  'tests/p0AbaV3TutorialTasks26to28.regression.test.mjs',
  'tests/p0Financial403ScopeAndGraphs.regression.test.ts',
  'tests/patientFinanceSessionReadability.regression.test.ts',
  'tests/patientFinancialSpecialtyClinicGate.test.ts',
  'tests/p1DashboardRestoreDevicePush.regression.test.mjs',
  'tests/p1PushAnamnesisLote03to07.regression.test.mjs',
  'tests/p1AnamnesisEditorDocumentsCharts.regression.test.mjs',
  'tests/clinicalProgramChangeOverview.regression.test.mjs',
  'tests/sidebarHoverExpansion.regression.test.mjs',
  'tests/p3SidebarNoHorizontalScroll.regression.test.mjs',
  'tests/vertoBrandingAssets.regression.test.mjs',
  'tests/salesSuperAdminCommercialModel20260830.regression.test.mjs',
  'tests/salesExactPerPatientBillingP0000.test.ts',
  'tests/salesExactPerPatientStripeQuantityP0000.test.ts',
  'tests/salesExactPatientCheckoutUiP0000.regression.test.mjs',
  'tests/modulePurchaseEligibility.test.ts',
  'tests/moduleSubscriptionUpgrade.test.ts',
  'tests/moduleSubscriptionUpgradeExecution.test.ts',
  'tests/moduleSubscriptionUpgradeInvoiceEvidence.test.ts',
  'tests/moduleSubscriptionUpgradeFrozenPrice.test.ts',
  'tests/moduleSubscriptionUpgradeContract.test.ts',
  'tests/moduleUpgradeV5S1Finalization.regression.test.mjs',
  'tests/moduleUpgradeV5S1Http.test.ts',
  'tests/abaChartReadHandlers.test.ts',
  'tests/reminderValueNormalization.test.ts',
  'tests/clinicalReadExtractionParity.test.mjs',
  'tests/clinicalReadHandlersEquivalence.test.mjs',
  'tests/p2AdultSessionNoTechnicalCards.regression.test.mjs',
  'tests/p2PendingCancellationAgendaHighlight.regression.test.mjs',
  'tests/p2SingleStatusActions.regression.test.mjs',
  'tests/protocolImportExtractionParity.test.mjs',
  'tests/protocolImportHandlersEquivalence.test.mjs',
  'tests/patientPlanReadParity.test.mjs',
  'tests/patientPlanReadEquivalence.test.mjs',

];

for (const testFile of criticalTests) {
  if (!existsSync(join(root, testFile))) {
    fail(`teste: ${testFile}`, 'arquivo não encontrado');
    continue;
  }
  const command = testFile.endsWith('.mjs') ? process.execPath : 'tsx';
  const commandLabel = testFile.endsWith('.mjs') ? 'node' : 'tsx';
  console.log(`\n[critical-test] run: ${commandLabel} ${testFile}`);
  const result = spawnSync(command, [testFile], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, NODE_ENV: 'test' },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log(`[critical-test] exit_code=${result.status ?? 1} test=${testFile}`);
  if (result.status === 0) {
    pass(`teste: ${testFile}`);
  } else {
    fail(
      `teste: ${testFile}`,
      String(result.stderr || result.stdout || `status=${result.status}`).trim().slice(0, 1200),
    );
  }
}

console.log(`\nPRE-MAIN GATE: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
console.log(`Passes: ${passes.length}`);
for (const label of passes) console.log(`  ✓ ${label}`);
if (failures.length) {
  console.error(`\nFalhas: ${failures.length}`);
  for (const item of failures) {
    console.error(`  ✗ ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
  }
  process.exit(1);
}
