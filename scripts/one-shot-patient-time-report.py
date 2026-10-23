#!/usr/bin/env python3
"""One-shot, fail-closed extraction of the patient time report route."""
from pathlib import Path
import subprocess

path = Path("server.ts")
original = path.read_text(encoding="utf-8")
module = Path("services/patientTimeReportRoute.ts").read_text(encoding="utf-8")
start = module.index("  app.get('/api/reports/time/patient'")
end = module.rindex("  });}")
old = module[start:end + len("  });")] + "\n\n"
imp = "import { registerPatientTimeReportRoute } from './services/patientTimeReportRoute';\n"
registration = """  registerPatientTimeReportRoute(app, {
    checkAuth,
    requireClinicCapability,
    sanitizeString,
    currentClinicId,
    sanitizeIsoDateTime,
    fetchTimeReportAppointments,
    buildPatientTimeReport,
  });

"""
if not original.startswith("import ") or original.count(old) != 1 or imp in original:
    raise SystemExit("Abort: source changed, moved body differs, or import already present")
if not original[original.index(old) + len(old):].startswith("  app.get('/api/reports/time/professional'"):
    raise SystemExit("Abort: route ordering changed")
new = imp + original.replace(old, registration, 1)
if new.replace(registration, old, 1).removeprefix(imp) != original:
    raise SystemExit("Abort: non-reversible transformation")
if new.count("registerPatientTimeReportRoute(app, {") != 1 or new.count("app.get('/api/reports/time/patient'") != 0:
    raise SystemExit("Abort: unexpected route registrations")
path.write_text(new,encoding="utf-8")
diff = subprocess.run(["git","diff","--numstat","--","server.ts"],capture_output=True,text=True,check=True).stdout.strip()
added,deleted,name = diff.split("\t")
if name != "server.ts" or not (8 <= int(added) <= 25 and 30 <= int(deleted) <= 55):
    raise SystemExit("Abort: diff outside expected bounds " + diff)
print("Patient time report extraction exactly reversible:",diff)
