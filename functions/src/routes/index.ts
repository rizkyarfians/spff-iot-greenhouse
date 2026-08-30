import {
  Router,
} from 'express';

import {
  auditMutation,
  requireAdmin,
  requireAuth,
  requireCsrf,
  requireOperator,
} from '../middleware/operatorAuth.js';

import {
  authReadiness,
  deleteManagedUser,
  getAuditLogs,
  getUsers,
  loginUser,
  logoutUser,
  me,
  patchUser,
  postUser,
} from '../controllers/authController.js';

import {
  acknowledgeAlarm,
  bootstrap,
  createSchedule,
  dashboard,
  deleteSchedule,
  getAlarms,
  getAlarmDetail,
  getAutomaticControl,
  getDevices,
  getHistory,
  getLatestTelemetry,
  getLogs,
  getPumps,
  getSchedules,
  getSmartSoil,
  getSensors,
  getSettings,
  readiness,
  resolveAlarm,
  setScheduleEnabled,
  streamEvents,
  updatePump,
  updateAutomaticControl,
  updateSmartSoilSelection,
  updateSettings,
} from '../controllers/dashboardController.js';
import {
  registerController,
} from '../controllers/registrationController.js'


export const apiRouter =
  Router();


apiRouter.get(
  '/health',
  (
    _req,
    res,
  ) =>
    res.json({
      success: true,

      data: {
        service:
          'spff-api',

        status:
          'alive',
      },

      message:
        'IoT Dashboard API is running',

      timestamp:
        new Date()
          .toISOString(),
    }),
);


apiRouter.get(
  '/ready',
  readiness,
);


apiRouter.get(
  '/auth/ready',
  authReadiness,
);


apiRouter.post(
  '/auth/login',
  loginUser,
);


apiRouter.post(
  '/auth/register',
  registerController,
);
/*
 * Semua endpoint setelah ini
 * wajib session login.
 */
apiRouter.use(
  requireAuth,
);


apiRouter.use(
  auditMutation,
);


/*
 * AUTH
 */

apiRouter.get(
  '/auth/me',
  me,
);


apiRouter.post(
  '/auth/logout',
  requireCsrf,
  logoutUser,
);


/*
 * DASHBOARD READ
 */

apiRouter.get(
  '/bootstrap',
  bootstrap,
);


apiRouter.get(
  '/telemetry/latest',
  getLatestTelemetry,
);


apiRouter.get(
  '/events',
  streamEvents,
);


apiRouter.get(
  '/dashboard',
  dashboard,
);


apiRouter.get(
  '/sensors',
  getSensors,
);


apiRouter.get(
  '/sensors/history',
  getHistory,
);


apiRouter.get(
  '/pumps',
  getPumps,
);

apiRouter.get(
  '/smart-soil',
  getSmartSoil,
);

apiRouter.put(
  '/smart-soil/selection',
  requireAdmin,
  requireCsrf,
  updateSmartSoilSelection,
);


/*
 * PUMP:
 * admin + operator.
 */
apiRouter.patch(
  '/pumps/:id',
  requireOperator,
  requireCsrf,
  updatePump,
);


/*
 * ALARM
 */

apiRouter.get(
  '/alarms',
  getAlarms,
);

apiRouter.get(
  '/alarms/:id',
  getAlarmDetail,
);


/*
 * Operator boleh acknowledge.
 */
apiRouter.patch(
  '/alarms/:id/acknowledge',
  requireOperator,
  requireCsrf,
  acknowledgeAlarm,
);


/*
 * Resolve hanya admin.
 */
apiRouter.patch(
  '/alarms/:id/resolve',
  requireAdmin,
  requireCsrf,
  resolveAlarm,
);


/*
 * SCHEDULE
 */

apiRouter.get(
  '/schedules',
  getSchedules,
);


/*
 * Modifikasi schedule:
 * admin only.
 */
apiRouter.post(
  '/schedules',
  requireAdmin,
  requireCsrf,
  createSchedule,
);


apiRouter.patch(
  '/schedules/:id',
  requireAdmin,
  requireCsrf,
  setScheduleEnabled,
);


apiRouter.delete(
  '/schedules/:id',
  requireAdmin,
  requireCsrf,
  deleteSchedule,
);


/*
 * DEVICE / LOG
 */

apiRouter.get(
  '/devices',
  getDevices,
);


apiRouter.get(
  '/logs',
  getLogs,
);


/*
 * SETTINGS
 */

apiRouter.get(
  '/settings',
  getSettings,
);


/*
 * Modify setting:
 * admin only.
 */
apiRouter.put(
  '/settings',
  requireAdmin,
  requireCsrf,
  updateSettings,
);


/*
 * AUTOMATIC CONTROL
 * Read untuk semua user login; modifikasi admin only.
 */
apiRouter.get(
  '/automatic-control',
  getAutomaticControl,
);

apiRouter.put(
  '/automatic-control',
  requireAdmin,
  requireCsrf,
  updateAutomaticControl,
);


/*
 * USER MANAGEMENT
 * admin only.
 */

apiRouter.get(
  '/admin/users',
  requireAdmin,
  getUsers,
);


apiRouter.post(
  '/admin/users',
  requireAdmin,
  requireCsrf,
  postUser,
);


apiRouter.patch(
  '/admin/users/:id',
  requireAdmin,
  requireCsrf,
  patchUser,
);

apiRouter.delete(
  '/admin/users/:id',
  requireAdmin,
  requireCsrf,
  deleteManagedUser,
);


/*
 * AUDIT
 */

apiRouter.get(
  '/admin/audit-logs',
  requireAdmin,
  getAuditLogs,
);
