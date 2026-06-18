import type { TissXmlGenerationStrategy } from "./types";
import { communication040300Strategy } from "./versions/communication040300/generator";

const strategies = new Map<string, TissXmlGenerationStrategy>([
  [communication040300Strategy.communicationVersion, communication040300Strategy],
  ["4.03.00", communication040300Strategy]
]);

export function getTissOfficialStrategy(communicationVersion?: string | null) {
  const key = String(communicationVersion || communication040300Strategy.communicationVersion).trim();
  return strategies.get(key) || communication040300Strategy;
}

export function listTissOfficialStrategies() {
  return Array.from(strategies.values());
}
