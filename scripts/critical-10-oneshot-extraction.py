#!/usr/bin/env python3
"""Extract only the audited paid Director session HTTP route; fail closed."""
from pathlib import Path
import subprocess

server = Path("server.ts")
module = Path("services/publicSalesDirectorSessionRoute.ts")
expected_blob = "905ee36eded19cfb5b23a488c9463a0480b6952c"
marker = '  app.post(\n    "/api/public/sales-offers/:token/director-session",'
next_marker = "  const loadPublicSalesActivation"
new_import = "import { registerPublicSalesDirectorSessionRoute } from './services/publicSalesDirectorSessionRoute';\n"
registration = """  registerPublicSalesDirectorSessionRoute(app, {
    supabase,
    publicSalesPostPaymentLimiter,
    sanitizeString,
    sanitizeEmail,
    isUuid,
    resolveSalesPostPaymentContextToken,
    hashSalesOfferToken,
    deriveSalesActivationToken,
    // The contract verifier is declared later; defer evaluation until request time.
    verifySalesDirectorContractAccess: (params) => verifySalesDirectorContractAccess(params),
  });

"""
def fnv32(s):
    value = 2166136261
    for ch in s:
        value = ((value ^ ord(ch)) * 16777619) & 0xffffffff
    return f"{value:08x}"

source = server.read_text(encoding="utf-8")
assert subprocess.check_output(["git", "hash-object", "server.ts"], text=True).strip() == expected_blob, "base server.ts changed"
assert source.count(marker) == 1
assert source.count(next_marker) == 1
a = source.index(marker)
b = source.index(next_marker, a)
old_route = source[a:b]
assert fnv32(old_route) == "75bb604d"
assert old_route.endswith("  );\n\n")
module_source = module.read_text(encoding="utf-8")
assert module_source.count(marker) == 1
assert old_route in module_source, "module lacks unchanged original handler"
assert source.count('"/api/public/sales-offers/:token/director-session"') == 1
assert new_import not in source

new_source = source[:a] + registration + source[b:]
first_newline = new_source.index("\n") + 1
new_source = new_source[:first_newline] + new_import + new_source[first_newline:]
assert marker not in new_source
assert new_source.count("registerPublicSalesDirectorSessionRoute(app, {") == 1
assert len(source.splitlines()) == 92172
assert len(new_source.splitlines()) == 92039
server.write_text(new_source, encoding="utf-8")
print("item 10: server.ts 92172 -> 92039 (-133); route FNV32", fnv32(old_route))
