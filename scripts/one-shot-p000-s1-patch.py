#!/usr/bin/env python3
"""One-use, fail-closed patch for P000-S1; GitHub runner checks out the target branch."""
from pathlib import Path
import subprocess

path=Path("server.ts")
src=path.read_text(encoding="utf-8")
patches=[
("""function buildPatientProfileTypeFields(body: any) {
  const canonicalProfileType = normalizePatientProfileType(
    body?.patientProfileType ||
      body?.patient_profile_type ||
      body?.panelType ||
      body?.panel_type ||
      body?.profileType ||
      body?.profile_type ||
      body?.type,
  );
  return {""",
"""function buildPatientProfileTypeFields(body: any, partial = false) {
  const requestedProfile = body?.patientProfileType ||
    body?.patient_profile_type ||
    body?.panelType ||
    body?.panel_type ||
    body?.profileType ||
    body?.profile_type ||
    body?.type;
  const category = sanitizeString(body?.group || body?.patient_group || body?.grupo, 80)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const pediatricCategory = ['infantil','crianca','adolescente'].includes(category);
  // PATCH of an unrelated field must not overwrite KIDS/ABA with default ADULT.
  // A pediatric category, even beside a stale ADULT alias, remains KIDS.
  if (partial && !requestedProfile && !pediatricCategory) return {};
  const canonicalProfileType = pediatricCategory ? 'KIDS' : normalizePatientProfileType(requestedProfile);
  return {"""),
("function buildPatientIdentityPersistenceFields(body: any) {",
 "function buildPatientIdentityPersistenceFields(body: any, options: { partial?: boolean } = {}) {"),
("  const profileFields = buildPatientProfileTypeFields(body);",
 "  const profileFields = buildPatientProfileTypeFields(body, options.partial === true);"),
("...(hasIdentityPersistencePatch ? buildPatientIdentityPersistenceFields(patientIdentityPayload) : {}),",
 "...(hasIdentityPersistencePatch ? buildPatientIdentityPersistenceFields(patientIdentityPayload, { partial: true }) : {}),"),
]
for old,new in patches:
    if src.count(old)!=1: raise SystemExit("Abort: anchor absent/nonunique: "+old[:60])
    src=src.replace(old,new,1)
path.write_text(src,encoding="utf-8")
out=subprocess.run(["git","diff","--numstat","--","server.ts"],capture_output=True,text=True,check=True).stdout.strip()
added,deleted,filename=out.split("\t")
if filename!="server.ts" or not (5<=int(added)<=30) or not (1<=int(deleted)<=18):
    raise SystemExit("Abort: unexpected patch size: "+out)
print("P000-S1 bounded patch verified:",out)
