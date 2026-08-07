const text = (value: unknown) => String(value ?? '').trim();

const snapshotOf = (row: any) => (
  row?.snapshot && typeof row.snapshot === 'object'
    ? row.snapshot
    : row?.snapshot_data && typeof row.snapshot_data === 'object'
      ? row.snapshot_data
      : {}
);

/**
 * A zero-valued guide is eligible only when the frozen pre-guide snapshot
 * proves that the payer policy was explicitly applied and documented.
 */
export function isFrozenZeroAmountXmlAllowed(row: any) {
  const snapshot = snapshotOf(row);
  const procedure = snapshot.procedure || {};
  const requirements = snapshot.payer?.requirements || {};
  const policyApplied = procedure.zeroAmountXmlPolicyApplied === true || procedure.zero_amount_xml_policy_applied === true;
  const payerAllows = requirements.allowsZeroAmountXml === true || requirements.allows_zero_amount_xml === true;
  const reason = text(
    procedure.zeroAmountXmlReason ??
      procedure.zero_amount_xml_reason ??
      requirements.zeroAmountXmlReason ??
      requirements.zero_amount_xml_reason,
  );
  return policyApplied && payerAllows && Boolean(reason);
}

export function getOfficialTissAmountBlockReason(row: any) {
  const snapshot = snapshotOf(row);
  const rawAmount = row?.totalAmountCents ?? row?.total_amount_cents ?? snapshot.procedure?.totalAmountCents ?? snapshot.procedure?.total_amount_cents;
  if (rawAmount === null || rawAmount === undefined || rawAmount === '') return 'Sem valor';
  const amountCents = Number(rawAmount);
  if (!Number.isFinite(amountCents) || amountCents < 0) return 'Sem valor';
  if (amountCents === 0 && !isFrozenZeroAmountXmlAllowed(row)) return 'Sem valor';
  return null;
}
