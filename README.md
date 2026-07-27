# IoT Greenhouse Dashboard

Dashboard monitoring dan kontrol IoT untuk pertanian/greenhouse. Frontend menggunakan React, Vite, TypeScript, Tailwind CSS, React Router, Lucide, Recharts, dan Axios. REST API menggunakan Express + TypeScript dan dapat dijalankan sebagai server lokal maupun Firebase Cloud Function generasi kedua.

## Struktur proyek

```text
iot-dashboard/
├── frontend/
│   ├── public/
│   └── src/
│       ├── api/
│       ├── components/
│       ├── hooks/
│       ├── layouts/
│       ├── pages/
│       ├── services/
│       ├── types/
│       └── utils/
├── functions/
│   └── src/
│       ├── controllers/
│       ├── data/
│       ├── middleware/
│       ├── routes/
│       ├── services/
│       └── types/
├── firebase.json
└── package.json
```

## Menjalankan secara lokal

Persyaratan: Node.js 22 dan npm.

```bash
npm install
copy frontend\.env.example frontend\.env
copy functions\.env.example functions\.env
npm run dev
```

Frontend tersedia di `http://localhost:5173` dan backend di `http://localhost:5001`. Jalankan salah satu sisi saja dengan `npm run dev:frontend` atau `npm run dev:backend`.

Environment frontend:

```env
VITE_API_BASE_URL=http://localhost:5001/api
```

Jika variabel tersebut tidak dibuat, frontend memakai `/api`, sehingga cocok untuk Firebase Hosting dan proxy development Vite. Untuk backend pada komputer lain di jaringan lokal, arahkan variabel ke `http://IP-SERVER:5001/api`. Browser yang membuka dashboard harus dapat mengakses IP dan port tersebut.

Environment backend:

```env
PORT=5001
CORS_ORIGIN=http://localhost:5173
API_DELAY_MS=350
```

`CORS_ORIGIN` dapat berisi beberapa origin yang dipisahkan koma. `API_DELAY_MS` mensimulasikan latensi agar loading state mudah diuji.

## Pemeriksaan kualitas

```bash
npm run lint
npm run build
```

## Firebase Emulator

Firebase Hosting hanya menjalankan hasil build frontend. Express dijalankan oleh Firebase Functions melalui function bernama `api` di region `asia-southeast2`.

```bash
npm run firebase:emulators
```

Hosting emulator tersedia di `http://localhost:5000`. Rewrite `/api/**` diarahkan ke Function emulator.

## Deployment Firebase

Salin `.firebaserc.example` menjadi `.firebaserc` dan isi project ID, atau pilih project secara interaktif:

```bash
npm run build
npx --yes firebase-tools@15.24.0 login
npx --yes firebase-tools@15.24.0 use --add
npx --yes firebase-tools@15.24.0 deploy --only hosting,functions
```

Perintah singkat setelah autentikasi dan project dikonfigurasi:

```bash
npm run firebase:deploy
```

## Endpoint API

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/health` | Status API |
| GET | `/api/dashboard` | Ringkasan lengkap dashboard |
| GET | `/api/sensors` | Nilai sensor terbaru |
| GET | `/api/sensors/history?type=ph&range=day` | Riwayat time-series |
| GET | `/api/pumps` | Daftar pompa |
| PATCH | `/api/pumps/:id` | Ubah status pompa dengan `{ "isActive": true }` |
| GET | `/api/alarms` | Alarm; filter `severity`, `acknowledged`, `limit` |
| PATCH | `/api/alarms/:id/acknowledge` | Tandai alarm diketahui |
| GET | `/api/schedules` | Jadwal kontrol dan penyiraman |

## Data dan integrasi berikutnya

Seluruh data saat ini merupakan dummy data dari `functions/src/data/mockData.ts`. Aksesnya dipisahkan melalui `functions/src/services/mockRepository.ts`, sehingga dapat diganti dengan Firestore, Realtime Database, MySQL, PostgreSQL, MQTT, atau Modbus tanpa memindahkan data ke komponen React.

File utama yang umum diedit:

- `frontend/src/pages/DashboardPage.tsx` — komposisi halaman.
- `frontend/src/styles.css` — layout responsif dan tampilan visual.
- `frontend/src/services/dashboardService.ts` — komunikasi REST API.
- `functions/src/routes/index.ts` — definisi endpoint.
- `functions/src/services/mockRepository.ts` — lapisan data.
- `functions/src/data/mockData.ts` — dummy data.
- `firebase.json` — Hosting, Functions, rewrite, dan emulator.
