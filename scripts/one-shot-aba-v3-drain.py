#!/usr/bin/env python3
"""One-shot exact, reversible extraction. Fails closed if staging source changed."""
from pathlib import Path
import subprocess

path=Path("server.ts")
original=path.read_text(encoding="utf-8")
module=Path("services/abaV3DrainStatusHandler.ts").read_text(encoding="utf-8")
start=module.index("  return async (req: any, res) => {")+len("  return ")
end=module.rindex("    };")+len("    }")
original_handler="    "+module[start:end]
target=original_handler+"\n  );"
replacement="    createAbaV3DrainStatusHandler({ sanitizeString, isUuid, supabase, handleAbaV3RolloutRpcError })\n  );"
imp="import { createAbaV3DrainStatusHandler } from './services/abaV3DrainStatusHandler';\n"
route_key="'/api/aba/v3/admin/drain-status'"
cohort_key="'/api/aba/v3/admin/cohort-catalog'"
if original.count(target)!=1 or original.count(route_key)!=1 or original.count(cohort_key)!=1 or imp in original:
    raise SystemExit("ABORT: source or route identity changed")
before=original.index(target)
route=original.rfind("  app.get(",0,before)
if route<0 or route>before or route_key not in original[route:before] or cohort_key not in original[before:before+2200]:
    raise SystemExit("ABORT: handler not in expected route")
scope=original[route:before]
if "requireAbaV3PreflightFeature,\n    checkAuth,\n    checkPlatformAdmin,\n" not in scope:
    raise SystemExit("ABORT: protected route middleware changed")
new=imp+original.replace(target,replacement,1)
if new.replace(replacement,target,1).removeprefix(imp)!=original:
    raise SystemExit("ABORT: not exactly reversible")
if new.count("createAbaV3DrainStatusHandler({")!=1 or new.count(route_key)!=1:
    raise SystemExit("ABORT: duplicate handler")
path.write_text(new,encoding="utf-8")
stat=subprocess.run(["git","diff","--numstat","--","server.ts"],capture_output=True,text=True,check=True).stdout.strip()
added,deleted,name=stat.split("\t")
if name!="server.ts" or not (1<=int(added)<=6 and 24<=int(deleted)<=36):
    raise SystemExit("ABORT: diff outside expected bounds "+stat)
print("ABA v3 drain handler extracted with byte-identical logic:",stat)
