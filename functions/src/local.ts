import 'dotenv/config';
import { app } from './app.js';

const port = Number(process.env.PORT ?? 5001);
const host = process.env.API_HOST?.trim() || '127.0.0.1';

app.listen(port, host, () => console.log(`IoT Dashboard API listening on http://${host}:${port}`));
