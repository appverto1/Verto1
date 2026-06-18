export type TissOfficialStrategyDescriptor = {
  strategyKey: "communication040300";
  communicationVersion: "04.03.00";
  contentStructureVersion: "202511";
  tussVersion: "202605";
  guideType: "sp_sadt";
};

export const TISS_OFFICIAL_STRATEGY_KEY = "communication040300";
export const TISS_OFFICIAL_COMMUNICATION_VERSION = "04.03.00";
export const TISS_OFFICIAL_CONTENT_STRUCTURE_VERSION = "202511";
export const TISS_OFFICIAL_TUSS_VERSION = "202605";
export const TISS_OFFICIAL_GUIDE_TYPE = "sp_sadt";

export function getDefaultTissOfficialStrategyDescriptor(): TissOfficialStrategyDescriptor {
  return {
    strategyKey: TISS_OFFICIAL_STRATEGY_KEY,
    communicationVersion: TISS_OFFICIAL_COMMUNICATION_VERSION,
    contentStructureVersion: TISS_OFFICIAL_CONTENT_STRUCTURE_VERSION,
    tussVersion: TISS_OFFICIAL_TUSS_VERSION,
    guideType: TISS_OFFICIAL_GUIDE_TYPE,
  };
}
