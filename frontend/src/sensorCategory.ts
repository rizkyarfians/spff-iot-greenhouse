export const isEnergySensor = (key: string) => key === 'battery_voltage' || key.startsWith('ac_')
