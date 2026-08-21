import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import type {
  AppRole,
} from '@spff/contracts';

import {
  countUsers,
  createUser,
  isValidPassword,
  isValidUsername,
  listAuditLogs,
  listUsers,
  login,
  revokeSession,
  updateUser,
} from '../services/authService.js';

import {
  clientIp,
  CSRF_COOKIE,
  SESSION_COOKIE,
} from '../middleware/operatorAuth.js';


type AsyncController = (
  req: Request,
  res: Response,
) => Promise<
  Response
  | void
>;


const run = (
  controller:
  AsyncController,
) =>

  async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {

    try {

      await controller(
        req,
        res,
      );

    } catch (error) {

      next(error);
    }
  };


const cookieSecure =
  (
    process.env.COOKIE_SECURE
    ?? 'false'
  ).toLowerCase()
  === 'true';


const sessionHours =
  Math.max(
    1,
    Math.min(
      Number(
        process.env.AUTH_SESSION_HOURS
        ?? 12,
      ),
      168,
    ),
  );


function setAuthCookies(
  res: Response,
  sessionToken: string,
  csrfToken: string,
) {

  const maxAge =
    sessionHours
    * 60
    * 60
    * 1000;


  /*
   * Session cookie:
   * - HttpOnly, tidak boleh dibaca JavaScript
   * - cukup dikirim untuk endpoint /api
   */
  res.cookie(
    SESSION_COOKIE,
    sessionToken,
    {
      httpOnly: true,

      sameSite:
        'strict',

      secure:
        cookieSecure,

      path:
        '/api',

      maxAge,
    },
  );


  /*
   * Hapus CSRF cookie lama yang sebelumnya
   * dibuat dengan Path=/api.
   *
   * Ini penting supaya tidak ada dua cookie
   * spff_csrf dengan path berbeda.
   */
  res.clearCookie(
    CSRF_COOKIE,
    {
      httpOnly: false,

      sameSite:
        'strict',

      secure:
        cookieSecure,

      path:
        '/api',
    },
  );


  /*
   * CSRF cookie harus bisa dibaca frontend
   * melalui document.cookie.
   *
   * Karena dashboard berada di "/",
   * gunakan Path="/".
   */
  res.cookie(
    CSRF_COOKIE,
    csrfToken,
    {
      httpOnly: false,

      sameSite:
        'strict',

      secure:
        cookieSecure,

      path:
        '/',

      maxAge,
    },
  );
}


function clearAuthCookies(
  res: Response,
) {

  res.clearCookie(
    SESSION_COOKIE,
    {
      httpOnly: true,

      sameSite:
        'strict',

      secure:
        cookieSecure,

      path:
        '/api',
    },
  );


  /*
   * Cookie CSRF versi baru.
   */
  res.clearCookie(
    CSRF_COOKIE,
    {
      httpOnly: false,

      sameSite:
        'strict',

      secure:
        cookieSecure,

      path:
        '/',
    },
  );


  /*
   * Bersihkan juga cookie versi lama
   * Path=/api sebagai migration cleanup.
   */
  res.clearCookie(
    CSRF_COOKIE,
    {
      httpOnly: false,

      sameSite:
        'strict',

      secure:
        cookieSecure,

      path:
        '/api',
    },
  );
}


export const loginUser =
  run(
    async (
      req,
      res,
    ) => {

      const username =
        String(
          req.body
            ?.username
          ?? '',
        )
          .trim()
          .toLowerCase();


      const password =
        String(
          req.body
            ?.password
          ?? '',
        );


      if (
        !isValidUsername(
          username,
        )

        || password.length < 1

        || password.length
          > 128
      ) {

        return res
          .status(400)
          .json({
            success: false,

            data: null,

            message:
              'Username atau password tidak valid.',

            errors: [
              'credentials',
            ],
          });
      }


      const result =
        await login(
          username,
          password,
          clientIp(req),
          req.get(
            'user-agent',
          )
          ?? null,
        );


      if (!result) {

        return res
          .status(401)
          .json({
            success: false,

            data: null,

            message:
              'Username atau password salah, akun nonaktif, atau sementara terkunci.',

            errors: [
              'credentials',
            ],
          });
      }


      setAuthCookies(
        res,
        result.sessionToken,
        result.csrfToken,
      );


      return res.json({
        success: true,

        data:
          result.user,

        message:
          'Login berhasil.',
      });
    },
  );


export const me =
  run(
    async (
      req,
      res,
    ) => {

      if (!req.auth) {

        return res
          .status(401)
          .json({
            success: false,

            data: null,

            message:
              'Belum login.',

            errors: [
              'authentication',
            ],
          });
      }


      const {
        userId,
        username,
        displayName,
        role,
      } = req.auth;


      return res.json({
        success: true,

        data: {
          userId,
          username,
          displayName,
          role,
        },

        message:
          'Session aktif.',
      });
    },
  );


export const logoutUser =
  run(
    async (
      req,
      res,
    ) => {

      if (req.auth) {

        await revokeSession(
          req.auth.sessionId,
        );
      }


      clearAuthCookies(
        res,
      );


      return res.json({
        success: true,

        data: null,

        message:
          'Logout berhasil.',
      });
    },
  );


export const getUsers =
  run(
    async (
      _req,
      res,
    ) => {

      return res.json({
        success: true,

        data:
          await listUsers(),

        message:
          'Daftar user berhasil dimuat.',
      });
    },
  );


export const postUser =
  run(
    async (
      req,
      res,
    ) => {

      const username =
        String(
          req.body
            ?.username
          ?? '',
        )
          .trim()
          .toLowerCase();


      const displayName =
        String(
          req.body
            ?.displayName
          ?? '',
        )
          .trim();


      const password =
        String(
          req.body
            ?.password
          ?? '',
        );


      const role: AppRole | undefined =
  req.body?.role === 'admin'
  || req.body?.role === 'operator'
    ? req.body.role
    : undefined;


      if (
        !isValidUsername(
          username,
        )

        || !displayName

        || displayName.length
          > 80

        || !isValidPassword(
          password,
        )

        || !role

        || ![
          'admin',
          'operator',
        ].includes(
          role,
        )
      ) {

        return res
          .status(400)
          .json({
            success: false,

            data: null,

            message:
              'Data user tidak valid. Username 3-32 karakter, password minimal 12 karakter.',

            errors: [
              'user',
            ],
          });
      }


      try {

        const user =
          await createUser({
            username,
            displayName,
            password,
            role,
          });


        return res
          .status(201)
          .json({
            success: true,

            data:
              user,

            message:
              'User berhasil dibuat.',
          });

      } catch (error) {

        if (
          error instanceof Error

          && error.message
            === 'USERNAME_EXISTS'
        ) {

          return res
            .status(409)
            .json({
              success: false,

              data: null,

              message:
                'Username sudah digunakan.',

              errors: [
                'username',
              ],
            });
        }


        throw error;
      }
    },
  );


export const patchUser =
  run(
    async (
      req,
      res,
    ) => {

      const targetId =
        String(
          req.params.id,
        );


      if (
        req.auth
          ?.userId
        === targetId

        && (
          req.body
            ?.enabled
          === false

          || req.body
            ?.role
          === 'operator'
        )
      ) {

        return res
          .status(409)
          .json({
            success: false,

            data: null,

            message:
              'Admin tidak boleh menonaktifkan atau menurunkan role akun yang sedang dipakai sendiri.',

            errors: [
              'self-protection',
            ],
          });
      }


      const displayName =
        req.body
          ?.displayName
        === undefined

          ? undefined

          : String(
              req.body
                .displayName,
            ).trim();


      const role: AppRole | undefined =
  req.body?.role === 'admin'
  || req.body?.role === 'operator'
    ? req.body.role
    : undefined;


      const enabled: boolean | undefined =
  typeof req.body?.enabled === 'boolean'
    ? req.body.enabled
    : undefined;


      const password =
        req.body
          ?.password
        === undefined

          ? undefined

          : String(
              req.body
                .password,
            );


      if (
        (
          displayName
          !== undefined

          && (
            !displayName
            || displayName.length
              > 80
          )
        )

        || (
          role
          !== undefined

          && ![
            'admin',
            'operator',
          ].includes(
            role,
          )
        )

        || (
          enabled
          !== undefined

          && typeof enabled
            !== 'boolean'
        )

        || (
          password
          !== undefined

          && !isValidPassword(
            password,
          )
        )
      ) {

        return res
          .status(400)
          .json({
            success: false,

            data: null,

            message:
              'Perubahan user tidak valid.',

            errors: [
              'user',
            ],
          });
      }


      try {

        const user =
          await updateUser(
            targetId,
            {
              displayName,
              role,
              enabled,
              password,
            },
          );


        if (!user) {

          return res
            .status(404)
            .json({
              success: false,

              data: null,

              message:
                'User tidak ditemukan.',

              errors: [],
            });
        }


        return res.json({
          success: true,

          data:
            user,

          message:
            'User berhasil diperbarui.',
        });

      } catch (error) {

        if (
          error instanceof Error

          && error.message
            === 'LAST_ADMIN'
        ) {

          return res
            .status(409)
            .json({
              success: false,

              data: null,

              message:
                'Minimal satu admin aktif harus tetap tersedia.',

              errors: [
                'last-admin',
              ],
            });
        }


        throw error;
      }
    },
  );


export const getAuditLogs =
  run(
    async (
      req,
      res,
    ) => {

      const requested =
        Number(
          req.query.limit
          ?? 100,
        );


      const limit =
        Number.isFinite(
          requested,
        )
          ? requested
          : 100;


      return res.json({
        success: true,

        data:
          await listAuditLogs(
            limit,
          ),

        message:
          'Audit log berhasil dimuat.',
      });
    },
  );


export const authReadiness =
  run(
    async (
      _req,
      res,
    ) => {

      const users =
        await countUsers();


      return res.json({
        success: true,

        data: {
          initialized:
            users > 0,

          userCount:
            users,
        },

        message:
          users > 0
            ? 'Local authentication initialized.'
            : 'Belum ada admin lokal.',
      });
    },
  );