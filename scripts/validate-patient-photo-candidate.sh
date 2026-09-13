#!/usr/bin/env bash
set -euo pipefail

PATCH_FILE=".verto-validation/VERTO_PRONTUARIO_PATIENT_PHOTO_PERSISTENCE_30a9816b.patch"
BASELINE_LOG="/tmp/photo-baseline.log"
CANDIDATE_LOG="/tmp/photo-candidate.log"

echo "=== 1/8 baseline legacy photo regression ==="
set +e
node tests/stagingPtsPatientPhotoRecovery20260901.regression.test.mjs >"$BASELINE_LOG" 2>&1
BASELINE_RC=$?
set -e
echo "baseline_exit=$BASELINE_RC"

# This is a known pre-existing assertion failure in current staging. Require that exact
# failure signature so a missing/changed baseline cannot be mistaken for equivalence.
if [ "$BASELINE_RC" -eq 0 ]; then
  echo "Expected the known pre-existing legacy photo regression failure, but baseline passed."
  exit 1
fi
grep -F "patientProfilePhotoUploadGuard = requireClinicCapability" "$BASELINE_LOG" >/dev/null

echo "=== 2/8 apply exact candidate patch ==="
git apply --check --whitespace=error-all "$PATCH_FILE"
git apply --whitespace=error-all "$PATCH_FILE"
git diff --check

echo "=== 3/8 candidate legacy photo regression ==="
set +e
node tests/stagingPtsPatientPhotoRecovery20260901.regression.test.mjs >"$CANDIDATE_LOG" 2>&1
CANDIDATE_RC=$?
set -e
echo "candidate_exit=$CANDIDATE_RC"

if [ "$CANDIDATE_RC" -ne "$BASELINE_RC" ]; then
  echo "Candidate changed legacy photo regression exit status."
  exit 1
fi
grep -F "patientProfilePhotoUploadGuard = requireClinicCapability" "$CANDIDATE_LOG" >/dev/null
# Same checkout/path, therefore the failure outputs must be byte-identical.
cmp -s "$BASELINE_LOG" "$CANDIDATE_LOG" || {
  echo "Candidate changed the known pre-existing legacy failure output."
  diff -u "$BASELINE_LOG" "$CANDIDATE_LOG" | head -120 || true
  exit 1
}
echo "legacy_photo_failure_equivalence=PASS"

echo "=== 4/8 new patient photo regression ==="
node tests/patientClinicManagedPhotoPersistence.regression.test.mjs

echo "=== 5/8 finance/TISS regressions ==="
node tests/patientFinancialPlanFinanceWithoutTissPayload.regression.test.mjs
node tests/patientFinancialPlanTissPreservationOnGenericFinancialSave.regression.test.mjs

echo "=== 6/8 security regression ==="
node tests/security.regression.test.mjs

echo "=== 7/8 go-live hardening ==="
node tests/goLiveHardening.test.mjs

echo "=== 8/8 production build ==="
npm run build

echo "=== PATIENT PHOTO CANDIDATE VALIDATION PASS ==="
