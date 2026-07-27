import { Router } from 'express';
import { acknowledgeAlarm, dashboard, getAlarms, getHistory, getPumps, getSchedules, getSensors, updatePump } from '../controllers/dashboardController.js';

export const apiRouter = Router();
apiRouter.get('/health', (_req, res) => res.json({ success: true, message: 'IoT Dashboard API is running', timestamp: new Date().toISOString() }));
apiRouter.get('/dashboard', dashboard);
apiRouter.get('/sensors', getSensors);
apiRouter.get('/sensors/history', getHistory);
apiRouter.get('/pumps', getPumps);
apiRouter.patch('/pumps/:id', updatePump);
apiRouter.get('/alarms', getAlarms);
apiRouter.patch('/alarms/:id/acknowledge', acknowledgeAlarm);
apiRouter.get('/schedules', getSchedules);
