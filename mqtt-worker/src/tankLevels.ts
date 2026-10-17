import { deriveTelemetrySensorHealth, type TelemetryMessage } from "@spff/contracts";

// Legacy *_distance_cm fields contain liquid height measured from the bottom.
// Heights are tank heights, not sensor-to-surface distances or tank volumes.
const tanks = [
  { distance: "tank_water_distance_cm", level: "tank_water_level_pct", height: 180 },
  { distance: "tank_fert_distance_cm", level: "tank_fert_level_pct", height: 90 },
] as const;

export function deriveTankLevels(message: TelemetryMessage) {
  const sensors = { ...message.sensors };
  const sensorHealth = deriveTelemetrySensorHealth(message);
  // Do not apply this installation's calibration to other devices/sites.
  if (message.siteId !== "greenhouse-01" || message.deviceId !== "esp32-s3-01") {
    return { sensors, sensorHealth };
  }
  for (const tank of tanks) {
    const liquidHeight = sensors[tank.distance];
    delete sensors[tank.level];
    if (sensorHealth[tank.distance]?.valid === false) {
      sensorHealth[tank.level] = { ...sensorHealth[tank.distance]! };
    } else if (typeof liquidHeight !== "number" || !Number.isFinite(liquidHeight)) {
      sensorHealth[tank.level] = { valid: false, reason: "not_reported" };
    } else if (liquidHeight < 0 || liquidHeight > tank.height) {
      sensorHealth[tank.level] = { valid: false, reason: "height_out_of_range" };
    } else {
      sensors[tank.level] = Math.round((liquidHeight / tank.height) * 1000) / 10;
      sensorHealth[tank.level] = { valid: true };
    }
  }
  return { sensors, sensorHealth };
}
