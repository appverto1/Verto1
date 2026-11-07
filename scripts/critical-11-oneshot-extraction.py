#!/usr/bin/env python3
"""Extract only the audited Director e-mail/password activation route; fail closed."""
from pathlib import Path
import subprocess

server_file = Path("server.ts")
module_file = Path("services/publicSalesActivationPasswordRoute.ts")
expected_blob = "f281ccf2d1d4f33f60081efa196c9d2d9e4bc8d3"
start_marker = '  app.post(\n    "/api/public/sales-activations/:token/password",'
end_marker = "  const stripeSubscriptionToEntitlementStatus"
registration = """  registerPublicSalesActivationPasswordRoute(app, {
    supabase,
    publicSalesActivationLimiter,
    validateStrongPassword,
    loadPublicSalesActivation,
    findAuthUserByEmail,
    fetchProfileWithSchemaFallback,
    insertUserProfileWithSchemaFallback,
    extractMissingColumnName,
    cleanObject,
    ensureClinicAndMembershipForCoordinator,
    // This function is declared later in startServer, so defer reading it
    // until the authenticated request is processed, as in the original closure.
    finalizeSalesActivationForUser: (params) => finalizeSalesActivationForUser(params),
    maskEmail,
    sanitizeEmail,
    sanitizeString,
  });

"""
new_import = "import { registerPublicSalesActivationPasswordRoute } from './services/publicSalesActivationPasswordRoute';\n"

def fnv32(source):
    h = 2166136261
    for ch in source:
        h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return f"{h:08x}"

source = server_file.read_text(encoding="utf-8")
assert subprocess.check_output(["git", "hash-object", "server.ts"], text=True).strip() == expected_blob, "server.ts base changed"
assert source.count(start_marker) == 1 and source.count(end_marker) == 1
a = source.index(start_marker)
b = source.index(end_marker, a)
old_route = source[a:b]
assert fnv32(old_route) == "9a23e4a1", "original handler changed"
assert old_route.endswith("  );\n\n")
module_source = module_file.read_text(encoding="utf-8")
assert module_source.count(start_marker) == 1 and old_route in module_source
assert new_import not in source
new_source = source[:a] + registration + source[b:]
nl = new_source.index("\n") + 1
new_source = new_source[:nl] + new_import + new_source[nl:]
assert start_marker not in new_source
assert new_source.count("registerPublicSalesActivationPasswordRoute(app, {") == 1
assert len(source.splitlines()) == 92039
assert 250 <= len(source.splitlines())-len(new_source.splitlines()) <= 280
server_file.write_text(new_source, encoding="utf-8")
print("item 11 server.ts",len(source.splitlines()),"->",len(new_source.splitlines()),"hash",fnv32(old_route))
