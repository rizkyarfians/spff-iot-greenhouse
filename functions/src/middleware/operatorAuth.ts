import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import type {
  AppRole,
  AuthUser,
} from '@spff/contracts';

import {
  authenticate,
  hashToken,
  writeAudit,
} from '../services/authService.js';


export const SESSION_COOKIE =
  'spff_session';

export const CSRF_COOKIE =
  'spff_csrf';


export interface RequestAuth
  extends AuthUser {

  sessionId: string;

  csrfHash: string;
}


declare module 'express-serve-static-core' {

  interface Request {
    auth?: RequestAuth;
  }
}


function parseCookies(
  header: string | undefined,
): Record<string, string> {

  if (!header) {
    return {};
  }

  const result:
  Record<string, string> = {};

  for (
    const part
    of header.split(';')
  ) {

    const separator =
      part.indexOf('=');

    if (separator <= 0) {
      continue;
    }

    const key =
      part
        .slice(
          0,
          separator,
        )
        .trim();

    const rawValue =
      part
        .slice(
          separator + 1,
        )
        .trim();

    try {

      result[key] =
        decodeURIComponent(
          rawValue,
        );

    } catch {

      result[key] =
        rawValue;
    }
  }

  return result;
}


export function clientIp(
  req: Request,
): string | null {

  const value =
    req.ip
    || req.socket.remoteAddress
    || '';

  if (!value) {
    return null;
  }

  if (
    value.startsWith(
      '::ffff:',
    )
  ) {
    return value.slice(7);
  }

  return value;
}


export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {

  try {

    const cookies =
      parseCookies(
        req.headers.cookie,
      );

    const token =
      cookies[
        SESSION_COOKIE
      ];


    if (!token) {

      return res
        .status(401)
        .json({
          success: false,

          data: null,

          message:
            'Silakan login terlebih dahulu.',

          errors: [
            'authentication',
          ],
        });
    }


    const session =
      await authenticate(
        token,
      );


    if (!session) {

      return res
        .status(401)
        .json({
          success: false,

          data: null,

          message:
            'Session tidak valid atau sudah kedaluwarsa.',

          errors: [
            'authentication',
          ],
        });
    }


    req.auth = {

      ...session.user,

      sessionId:
        session.sessionId,

      csrfHash:
        session.csrfHash,
    };


    return next();

  } catch (error) {

    return next(error);
  }
}


function requireRole(
  roles: AppRole[],
) {

  return (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {

    const auth =
      req.auth;


    if (!auth) {

      return res
        .status(401)
        .json({
          success: false,

          data: null,

          message:
            'Authentication diperlukan.',

          errors: [
            'authentication',
          ],
        });
    }


    if (
      !roles.includes(
        auth.role,
      )
    ) {

      return res
        .status(403)
        .json({
          success: false,

          data: null,

          message:
            'Role kamu tidak memiliki izin untuk aksi ini.',

          errors: [
            'authorization',
          ],
        });
    }


    return next();
  };
}


export const requireOperator =
  requireRole([
    'operator',
    'admin',
  ]);


export const requireAdmin =
  requireRole([
    'admin',
  ]);


export function requireCsrf(
  req: Request,
  res: Response,
  next: NextFunction,
) {

  if (
    [
      'GET',
      'HEAD',
      'OPTIONS',
    ].includes(
      req.method,
    )
  ) {
    return next();
  }


  const auth =
    req.auth;


  if (!auth) {

    return res
      .status(401)
      .json({
        success: false,

        data: null,

        message:
          'Authentication diperlukan.',

        errors: [
          'authentication',
        ],
      });
  }


  const cookies =
    parseCookies(
      req.headers.cookie,
    );


  const cookieToken =
    cookies[
      CSRF_COOKIE
    ]
    ?? '';


  const headerToken =
    req.get(
      'x-csrf-token',
    )
      ?.trim()
    ?? '';


  const valid =
    cookieToken.length >= 24

    && headerToken.length >= 24

    && cookieToken
      === headerToken

    && hashToken(
      headerToken,
    )
      === auth.csrfHash;


  if (!valid) {

    return res
      .status(403)
      .json({
        success: false,

        data: null,

        message:
          'CSRF token tidak valid.',

        errors: [
          'csrf',
        ],
      });
  }


  return next();
}


export function requestActor(
  req: Request,
): string {

  return (
    req.auth
      ?.username
    ?? 'unknown'
  );
}


function classifyMutation(
  req: Request,
) {

  const path =
    req.originalUrl
      .split('?')[0];


  if (
    path.includes(
      '/pumps/',
    )
  ) {
    return {
      action:
        'actuator.command',

      resourceType:
        'actuator',
    };
  }


  if (
    path.includes(
      '/alarms/',
    )
  ) {
    return {
      action:
        'alarm.change',

      resourceType:
        'alarm',
    };
  }


  if (
    path.includes(
      '/schedules',
    )
  ) {
    return {
      action:
        'schedule.change',

      resourceType:
        'schedule',
    };
  }


  if (
    path.includes(
      '/settings',
    )
  ) {
    return {
      action:
        'settings.change',

      resourceType:
        'settings',
    };
  }


  if (
    path.includes(
      '/admin/users',
    )
  ) {
    return {
      action:
        'user.change',

      resourceType:
        'user',
    };
  }


  if (
    path.includes(
      '/auth/logout',
    )
  ) {
    return {
      action:
        'auth.logout',

      resourceType:
        'session',
    };
  }


  return {
    action:
      'api.mutation',

    resourceType:
      'api',
  };
}


export function auditMutation(
  req: Request,
  res: Response,
  next: NextFunction,
) {

  if (
    [
      'GET',
      'HEAD',
      'OPTIONS',
    ].includes(
      req.method,
    )
  ) {
    return next();
  }


  res.on(
    'finish',
    () => {

      const auth =
        req.auth;


      if (!auth) {
        return;
      }


      const classification =
        classifyMutation(
          req,
        );


      const paramId =
        typeof req.params.id
        === 'string'

          ? req.params.id

          : Array.isArray(
              req.params.id,
            )

            ? req.params.id[0]
              ?? null

            : null;


      void writeAudit({

        userId:
          auth.userId,

        username:
          auth.username,

        role:
          auth.role,

        action:
          classification
            .action,

        resourceType:
          classification
            .resourceType,

        resourceId:
          paramId,

        success:
          res.statusCode >= 200
          && res.statusCode < 400,

        method:
          req.method,

        path:
          req.originalUrl
            .split('?')[0],

        status:
          res.statusCode,

        ipAddress:
          clientIp(req),

        userAgent:
          req.get(
            'user-agent',
          )
          ?? null,
      });
    },
  );


  return next();
}