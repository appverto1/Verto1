/**
 * Debug helper for tracking PEI maintenance panel state mutations
 * Controlled via localStorage.DEBUG_PEI_MAINTENANCE="1"
 * 
 * Usage:
 * - Browser console: localStorage.DEBUG_PEI_MAINTENANCE="1"
 * - All subsequent logs will appear even in production
 * 
 * To disable:
 * - Browser console: localStorage.removeItem('DEBUG_PEI_MAINTENANCE')
 */

export const isDebugPeiMaintenanceEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('DEBUG_PEI_MAINTENANCE') === '1';
};

export const debugPeiMaintenance = (group: string, message: string, data?: any): void => {
  if (!isDebugPeiMaintenanceEnabled()) return;
  
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
  const prefix = `[PEI-DEBUG ${timestamp}] [${group}]`;
  
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
};

/**
 * Log when mapper processes maintenance panel response
 */
export const debugMapperInput = (
  rawEligibleCount: number,
  rawScheduledCount: number,
  rawOtherSections: Record<string, number>
): void => {
  debugPeiMaintenance(
    'MAPPER',
    'Input: Raw response sections',
    {
      eligibleSkills: rawEligibleCount,
      scheduledProbes: rawScheduledCount,
      ...rawOtherSections,
    }
  );
};

export const debugMapperOutput = (
  mappedEligibleCount: number,
  mappedScheduledCount: number,
  mappedOtherSections: Record<string, number>
): void => {
  debugPeiMaintenance(
    'MAPPER',
    'Output: After mapping (with deduplication)',
    {
      eligibleSkills: mappedEligibleCount,
      scheduledProbes: mappedScheduledCount,
      ...mappedOtherSections,
    }
  );
};

/**
 * Log when eligible rows are rendered
 */
export const debugEligibleRowsRender = (
  dataSource: 'panel_persistent' | 'fallback_local' | 'loading',
  eligibleCount: number,
  additionalInfo?: Record<string, any>
): void => {
  debugPeiMaintenance(
    'ELIGIBLE-ROWS',
    `Using ${dataSource} - ${eligibleCount} rows`,
    additionalInfo
  );
};

/**
 * Log when fallback local is being used instead of panel
 */
export const debugFallbackTriggered = (reason: string, context: Record<string, any>): void => {
  debugPeiMaintenance(
    'FALLBACK',
    `⚠️ Using fallback instead of panel: ${reason}`,
    context
  );
};

/**
 * Log when a target should be filtered out but isn't
 */
export const debugFilteringIssue = (
  targetId: string,
  targetName: string,
  reason: string,
  context: Record<string, any>
): void => {
  debugPeiMaintenance(
    'FILTERING',
    `⚠️ Target ${targetName} (${targetId}) NOT filtered - ${reason}`,
    context
  );
};

/**
 * Log snapshot of current maintenance state
 */
export const debugStateSnapshot = (
  label: string,
  state: Record<string, any>
): void => {
  debugPeiMaintenance('STATE', `Snapshot: ${label}`, state);
};
