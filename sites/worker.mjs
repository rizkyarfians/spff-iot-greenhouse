const json = (data, message, status = 200) =>
  Response.json({ success: status < 400, data, message }, { status });

const times = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const historyValues = {
  ph: [6.8, 7.05, 7.12, 7.08, 7.2, 7.35, 7.22, 7.01, 7.08],
  ec: [1.3, 1.42, 1.55, 1.48, 1.62, 1.71, 1.65, 1.58, 1.62],
  temperature: [21, 22, 24, 25, 27, 26, 25, 24, 24],
  soilMoisture: [55, 62, 70, 72, 68, 66, 69, 71, 68],
  waterTank: [92, 89, 87, 84, 82, 80, 79, 78, 78],
  nutrientTank: [94, 92, 90, 87, 85, 82, 81, 80, 80],
};

let pumpState = [
  { id: 'pump-nutrient', name: 'Pompa Nutrisi', isActive: true, state: 'active', activeDuration: '05:03:00' },
  { id: 'pump-nutrient-mc', name: 'Pompa Nutrisi (MC)', isActive: true, state: 'active', activeDuration: '05:03:00' },
  { id: 'pump-watering', name: 'Pompa Penyiraman', isActive: false, state: 'inactive', activeDuration: '00:00:00' },
];

let alarmState = [
  { id: 'alarm-ec-1', title: 'EC Mendekati Batas', description: 'Nilai EC tanah 1,82 mS/cm mendekati batas maksimum.', severity: 'warning', acknowledged: false },
  { id: 'alarm-water', title: 'Tangki Air B Menurun', description: 'Ketinggian Tangki B 42%. Disarankan melakukan pengisian.', severity: 'info', acknowledged: false },
  { id: 'alarm-ec-2', title: 'EC Mendekati Batas', description: 'Kenaikan EC terdeteksi pada zona nutrisi 2.', severity: 'critical', acknowledged: false },
];

function snapshot() {
  const now = new Date().toISOString();
  const atHour = (hour) => {
    const value = new Date();
    value.setHours(hour, 0, 0, 0);
    return value.toISOString();
  };
  const sensors = [
    { id: 'sensor-ph', type: 'ph', name: 'pH Tanah', value: 7.2, unit: '', status: 'good', updatedAt: now },
    { id: 'sensor-ec', type: 'ec', name: 'EC', value: 1.62, unit: 'mS/cm', status: 'good', updatedAt: now },
    { id: 'sensor-water', type: 'waterTank', name: 'Tangki Air', value: 78, unit: '%', status: 'good', updatedAt: now },
    { id: 'sensor-nutrient', type: 'nutrientTank', name: 'Tangki Nutrisi', value: 80, unit: '%', status: 'good', updatedAt: now },
  ];
  const pumps = pumpState.map((pump) => ({ ...pump, updatedAt: now }));
  const alarms = alarmState.map((alarm) => ({ ...alarm, createdAt: now }));
  const schedules = [
    { id: 'schedule-nutrient', name: 'Penyiraman Nutrisi', scheduledAt: atHour(14), zone: 'Zona Nutrisi', status: 'today' },
    { id: 'schedule-fill', name: 'Pengisian Tangki', scheduledAt: atHour(16), zone: 'Tangki Air B', status: 'today' },
    { id: 'schedule-zone-1', name: 'Penyiraman Zona 1', scheduledAt: atHour(18), zone: 'Zona 1', status: 'today' },
  ];
  return {
    weather: { location: 'Dummy Location', temperature: 24, condition: 'Cerah', date: now },
    sensors,
    pumps,
    alarms,
    schedules,
  };
}

async function apiResponse(request, url) {
  const data = snapshot();
  if (request.method === 'GET' && url.pathname === '/api/dashboard') return json(data, 'Ringkasan dashboard berhasil dimuat.');
  if (request.method === 'GET' && url.pathname === '/api/sensors') return json(data.sensors, 'Data sensor berhasil dimuat.');
  if (request.method === 'GET' && url.pathname === '/api/pumps') return json(data.pumps, 'Data pompa berhasil dimuat.');
  if (request.method === 'GET' && url.pathname === '/api/alarms') return json(data.alarms, 'Data alarm berhasil dimuat.');
  if (request.method === 'GET' && url.pathname === '/api/schedules') return json(data.schedules, 'Data jadwal berhasil dimuat.');
  if (request.method === 'GET' && url.pathname === '/api/sensors/history') {
    const type = url.searchParams.get('type') || 'ph';
    const values = historyValues[type];
    return values
      ? json(values.map((value, index) => ({ time: times[index], value })), `Riwayat sensor ${type} berhasil dimuat.`)
      : json(null, 'Tipe sensor tidak didukung.', 400);
  }

  const pumpMatch = url.pathname.match(/^\/api\/pumps\/([^/]+)$/);
  if (request.method === 'PATCH' && pumpMatch) {
    const body = await request.json();
    const index = pumpState.findIndex((pump) => pump.id === pumpMatch[1]);
    if (index < 0) return json(null, 'Pompa tidak ditemukan.', 404);
    pumpState[index] = {
      ...pumpState[index],
      isActive: Boolean(body.isActive),
      state: body.isActive ? 'active' : 'inactive',
      activeDuration: body.isActive ? pumpState[index].activeDuration : '00:00:00',
    };
    return json({ ...pumpState[index], updatedAt: new Date().toISOString() }, `${pumpState[index].name} berhasil diperbarui.`);
  }

  const alarmMatch = url.pathname.match(/^\/api\/alarms\/([^/]+)\/acknowledge$/);
  if (request.method === 'PATCH' && alarmMatch) {
    const index = alarmState.findIndex((alarm) => alarm.id === alarmMatch[1]);
    if (index < 0) return json(null, 'Alarm tidak ditemukan.', 404);
    alarmState[index] = { ...alarmState[index], acknowledged: true };
    return json({ ...alarmState[index], createdAt: new Date().toISOString() }, 'Alarm sudah ditandai diketahui.');
  }

  return json(null, 'Endpoint tidak ditemukan.', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return apiResponse(request, url);

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
  },
};
