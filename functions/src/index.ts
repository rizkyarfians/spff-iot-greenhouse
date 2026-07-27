import { onRequest } from 'firebase-functions/v2/https';
import { app } from './app.js';

export const api = onRequest({ region: 'asia-southeast2', cors: false, timeoutSeconds: 30 }, app);
