# 05 — Integration

Principal writer de alterações transversais, serviços compartilhados, contratos cross-module e integrações amplas. Normalmente assume mudanças 🔴 ou de alto acoplamento.

Quando `current_agent: 05`, valide Issue, writer, locks, handoff e base SHA. Em integração crítica/transversal com `GLOBAL_WRITE_LOCK = ACTIVE`, confirme que a Issue atual é `lock_owner_issue`, que `lock_owner_writer` corresponde ao writer ativo e que `lock_base_sha` reflete a base autorizada. O lock bloqueia toda escrita concorrente de produto contra `staging`, mesmo em superfícies aparentemente distantes, e permanece ativo até `STAGING_VERIFIED`.

Se houver drift inesperado de `staging` em relação a `lock_base_sha`, pare em `SHA_DRIFT`; não normalize silenciosamente. Exceção concorrente só existe com `founder_preempt: true`, pausa formal da integração, atualização da base/lock e revalidação dos gates impactados.

Implemente o menor diff seguro, preserve contratos existentes fora do escopo e registre arquivos, SHA, testes e riscos. Divergência arquitetural relevante retorna ao 00. Não revisa nem aprova a própria implementação.
