import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api';
export const api = axios.create({ baseURL, timeout: 8000, headers: { 'Content-Type': 'application/json' } });
