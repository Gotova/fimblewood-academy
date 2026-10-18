/**
 * Fimblewood Academy — Region behavior "Alchemie-Station"
 *
 * Marks a Region (for example the academy's alchemy room) as holding
 * stationary alchemy tools. The GM ticks which ones. The behavior reacts to
 * no events: tools.mjs reads it whenever it needs to know what a character
 * standing in the region can use.
 */

import { STATION_BEHAVIOR } from "./tools.mjs";

class AlchemyStationBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["FIMBLEWOOD.Alchemy.Station"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      braukessel: new fields.BooleanField({ initial: true }),
      braukesselSlots: new fields.NumberField({ required: true, nullable: false, integer: true, min: 1, max: 12, initial: 3 }),
      destille: new fields.BooleanField({ initial: false }),
      athanor: new fields.BooleanField({ initial: false }),
      oelbad: new fields.BooleanField({ initial: false })
    };
  }
}

export function registerStationBehavior() {
  CONFIG.RegionBehavior.dataModels[STATION_BEHAVIOR] = AlchemyStationBehaviorType;
  CONFIG.RegionBehavior.typeLabels[STATION_BEHAVIOR] = "FIMBLEWOOD.Alchemy.Station.Label";
  CONFIG.RegionBehavior.typeIcons[STATION_BEHAVIOR] = "fa-solid fa-flask-vial";
}
