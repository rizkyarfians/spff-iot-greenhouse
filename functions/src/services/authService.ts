import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

import pg from 'pg';

import type {
  AppRole,
  AuthUser,
  ManagedUser,
} from '@spff/contracts';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST ?? '127.0.0.1',

  port: Number(
    process.env.PGPORT ?? 5432,
  ),

  database:
    process.env.PGDATABASE ?? 'spff',

  user:
    process.env.PGUSER ?? 'spff_app',

  password:
    process.env.PGPASSWORD,

  max: Math.max(
    2,
    Math.min(
      Number(process.env.PGPOOL_MAX ?? 10),
      20,
    ),
  ),

  idleTimeoutMillis: 30_000,

  connectionTimeoutMillis: 5_000,
});

const SESSION_HOURS = Math.max(
  1,
  Math.min(
    Number(
      process.env.AUTH_SESSION_HOURS ?? 12,
    ),
    168,
  ),
);

const MAX_FAILED_LOGINS = Math.max(
  3,
  Math.min(
    Number(
      process.env.AUTH_MAX_FAILED_LOGINS ?? 5,
    ),
    20,
  ),
);

const LOCK_MINUTES = Math.max(
  1,
  Math.min(
    Number(
      process.env.AUTH_LOCK_MINUTES ?? 15,
    ),
    1440,
  ),
);

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLEL = 1;
const SCRYPT_KEY_LENGTH = 64;


export interface AuthenticatedSession {
  user: AuthUser;

  sessionId: string;

  csrfHash: string;
}


export interface LoginResult
  extends AuthenticatedSession {

  sessionToken: string;

  csrfToken: string;

  expiresAt: string;
}


export interface AuditInput {
  userId: string | null;

  username: string;

  role: AppRole | null;

  action: string;

  resourceType: string;

  resourceId?: string | null;

  success: boolean;

  method?: string | null;

  path?: string | null;

  status?: number | null;

  ipAddress?: string | null;

  userAgent?: string | null;

  metadata?:
    | Record<string, unknown>
    | null;
}


interface UserRow {
  user_id: string;

  username: string;

  display_name: string;

  password_hash: string;

  role: AppRole;

  enabled: boolean;

  failed_login_count: number;

  locked_until: Date | null;

  last_login_at: Date | null;

  created_at: Date;

  updated_at: Date;
}


interface SessionRow
  extends UserRow {

  session_id: string;

  csrf_hash: string;
}


const normalizeUsername = (
  username: string,
) =>
  username
    .trim()
    .toLowerCase();


export const isValidUsername = (
  username: string,
) =>
  /^[a-z0-9][a-z0-9._-]{2,31}$/.test(
    normalizeUsername(username),
  );


export const isValidPassword = (
  password: string,
) =>
  password.length >= 12
  && password.length <= 128;


export function hashToken(
  token: string,
): string {

  return createHash('sha256')
    .update(token)
    .digest('hex');
}


async function derivePassword(
  password: string,
  salt: Buffer,
): Promise<Buffer> {

  return new Promise(
    (resolve, reject) => {

      scryptCallback(
        password,
        salt,
        SCRYPT_KEY_LENGTH,
        {
          N: SCRYPT_COST,
          r: SCRYPT_BLOCK_SIZE,
          p: SCRYPT_PARALLEL,
          maxmem:
            64
            * 1024
            * 1024,
        },
        (
          error,
          derivedKey,
        ) => {

          if (error) {
            reject(error);
            return;
          }

          resolve(
            Buffer.from(
              derivedKey,
            ),
          );
        },
      );
    },
  );
}


export async function hashPassword(
  password: string,
): Promise<string> {

  if (!isValidPassword(password)) {
    throw new Error(
      'Password harus 12-128 karakter.',
    );
  }

  const salt =
    randomBytes(16);

  const derived =
    await derivePassword(
      password,
      salt,
    );

  return [
    'scrypt',

    SCRYPT_COST,

    SCRYPT_BLOCK_SIZE,

    SCRYPT_PARALLEL,

    salt.toString(
      'base64url',
    ),

    derived.toString(
      'base64url',
    ),
  ].join('$');
}


async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {

  const [
    algorithm,
    costRaw,
    blockRaw,
    parallelRaw,
    saltRaw,
    hashRaw,
  ] = encoded.split('$');

  if (
    algorithm !== 'scrypt'
    || !costRaw
    || !blockRaw
    || !parallelRaw
    || !saltRaw
    || !hashRaw
  ) {
    return false;
  }

  const cost =
    Number(costRaw);

  const blockSize =
    Number(blockRaw);

  const parallel =
    Number(parallelRaw);

  if (
    cost !== SCRYPT_COST
    || blockSize !== SCRYPT_BLOCK_SIZE
    || parallel !== SCRYPT_PARALLEL
  ) {
    return false;
  }

  const expected =
    Buffer.from(
      hashRaw,
      'base64url',
    );

  if (
    expected.length
    !== SCRYPT_KEY_LENGTH
  ) {
    return false;
  }

  const actual =
    await derivePassword(
      password,
      Buffer.from(
        saltRaw,
        'base64url',
      ),
    );

  return timingSafeEqual(
    actual,
    expected,
  );
}


const toAuthUser = (
  row: Pick<
    UserRow,
    | 'user_id'
    | 'username'
    | 'display_name'
    | 'role'
  >,
): AuthUser => ({
  userId:
    row.user_id,

  username:
    row.username,

  displayName:
    row.display_name,

  role:
    row.role,
});


const toManagedUser = (
  row: UserRow,
): ManagedUser => ({

  userId:
    row.user_id,

  username:
    row.username,

  displayName:
    row.display_name,

  role:
    row.role,

  enabled:
    row.enabled,

  lastLoginAt:
    row.last_login_at
      ?.toISOString()
    ?? null,

  createdAt:
    row.created_at
      .toISOString(),

  updatedAt:
    row.updated_at
      .toISOString(),
});


export async function writeAudit(
  input: AuditInput,
): Promise<void> {

  try {

    await pool.query(
      `
      INSERT INTO spff.audit_logs (
        user_id,
        username,
        role,
        action,
        resource_type,
        resource_id,
        success,
        http_method,
        http_path,
        http_status,
        ip_address,
        user_agent,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        NULLIF($11, '')::inet,
        $12,
        $13::jsonb
      )
      `,
      [
        input.userId,

        input.username,

        input.role,

        input.action,

        input.resourceType,

        input.resourceId ?? null,

        input.success,

        input.method ?? null,

        input.path ?? null,

        input.status ?? null,

        input.ipAddress ?? null,

        input.userAgent ?? null,

        JSON.stringify(
          input.metadata ?? {},
        ),
      ],
    );

  } catch (error) {

    console.error(
      'Failed to write SPFF audit log',
      error,
    );
  }
}


export async function login(
  usernameInput: string,
  password: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<LoginResult | null> {

  const username =
    normalizeUsername(
      usernameInput,
    );

  const result =
    await pool.query<UserRow>(
      `
      SELECT
        user_id,
        username,
        display_name,
        password_hash,
        role,
        enabled,
        failed_login_count,
        locked_until,
        last_login_at,
        created_at,
        updated_at
      FROM spff.app_users
      WHERE username = $1
      `,
      [
        username,
      ],
    );

  const row =
    result.rows[0];

  if (!row) {

    await derivePassword(
      password
      || 'invalid-password',
      Buffer.alloc(
        16,
        7,
      ),
    );

    await writeAudit({
      userId: null,

      username:
        username
        || 'unknown',

      role: null,

      action:
        'auth.login',

      resourceType:
        'session',

      success: false,

      ipAddress,

      userAgent,

      metadata: {
        reason:
          'invalid_credentials',
      },
    });

    return null;
  }


  if (!row.enabled) {

    await writeAudit({
      userId:
        row.user_id,

      username:
        row.username,

      role:
        row.role,

      action:
        'auth.login',

      resourceType:
        'session',

      success:
        false,

      ipAddress,

      userAgent,

      metadata: {
        reason:
          'disabled',
      },
    });

    return null;
  }


  if (
    row.locked_until
    && row.locked_until
      .getTime()
      > Date.now()
  ) {

    await writeAudit({
      userId:
        row.user_id,

      username:
        row.username,

      role:
        row.role,

      action:
        'auth.login',

      resourceType:
        'session',

      success:
        false,

      ipAddress,

      userAgent,

      metadata: {
        reason:
          'locked',
      },
    });

    return null;
  }


  const valid =
    await verifyPassword(
      password,
      row.password_hash,
    );


  if (!valid) {

    const failedCount =
      row.failed_login_count + 1;

    const shouldLock =
      failedCount
      >= MAX_FAILED_LOGINS;

    await pool.query(
      `
      UPDATE spff.app_users
      SET
        failed_login_count = $2,

        locked_until =
          CASE
            WHEN $3
            THEN now()
              + (
                  $4::text
                  || ' minutes'
                )::interval
            ELSE NULL
          END

      WHERE user_id = $1
      `,
      [
        row.user_id,

        shouldLock
          ? 0
          : failedCount,

        shouldLock,

        LOCK_MINUTES,
      ],
    );


    await writeAudit({
      userId:
        row.user_id,

      username:
        row.username,

      role:
        row.role,

      action:
        'auth.login',

      resourceType:
        'session',

      success:
        false,

      ipAddress,

      userAgent,

      metadata: {
        reason:
          shouldLock
            ? 'locked_after_failures'
            : 'invalid_credentials',
      },
    });


    return null;
  }


  const sessionToken =
    randomBytes(32)
      .toString(
        'base64url',
      );

  const csrfToken =
    randomBytes(24)
      .toString(
        'base64url',
      );

  const sessionId =
    randomUUID();

  const expiresAt =
    new Date(
      Date.now()
      + SESSION_HOURS
        * 60
        * 60
        * 1000,
    );


  const client =
    await pool.connect();


  try {

    await client.query(
      'BEGIN',
    );


    await client.query(
      `
      UPDATE spff.app_users
      SET
        failed_login_count = 0,
        locked_until = NULL,
        last_login_at = now()
      WHERE user_id = $1
      `,
      [
        row.user_id,
      ],
    );


    await client.query(
      `
      INSERT INTO spff.auth_sessions (
        session_id,
        user_id,
        token_hash,
        csrf_hash,
        expires_at,
        ip_address,
        user_agent
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        NULLIF($6, '')::inet,
        $7
      )
      `,
      [
        sessionId,

        row.user_id,

        hashToken(
          sessionToken,
        ),

        hashToken(
          csrfToken,
        ),

        expiresAt,

        ipAddress,

        userAgent,
      ],
    );


    await client.query(
      'COMMIT',
    );

  } catch (error) {

    await client.query(
      'ROLLBACK',
    );

    throw error;

  } finally {

    client.release();
  }


  await writeAudit({
    userId:
      row.user_id,

    username:
      row.username,

    role:
      row.role,

    action:
      'auth.login',

    resourceType:
      'session',

    resourceId:
      sessionId,

    success:
      true,

    ipAddress,

    userAgent,
  });


  return {

    user:
      toAuthUser(row),

    sessionId,

    csrfHash:
      hashToken(
        csrfToken,
      ),

    sessionToken,

    csrfToken,

    expiresAt:
      expiresAt
        .toISOString(),
  };
}


export async function authenticate(
  sessionToken: string,
): Promise<AuthenticatedSession | null> {

  const result =
    await pool.query<SessionRow>(
      `
      SELECT
        s.session_id,
        s.csrf_hash,

        u.user_id,
        u.username,
        u.display_name,
        u.password_hash,
        u.role,
        u.enabled,
        u.failed_login_count,
        u.locked_until,
        u.last_login_at,
        u.created_at,
        u.updated_at

      FROM spff.auth_sessions s

      JOIN spff.app_users u
        ON u.user_id = s.user_id

      WHERE
        s.token_hash = $1

        AND s.revoked_at
          IS NULL

        AND s.expires_at
          > now()

        AND u.enabled = true
      `,
      [
        hashToken(
          sessionToken,
        ),
      ],
    );


  const row =
    result.rows[0];


  if (!row) {
    return null;
  }


  void pool.query(
    `
    UPDATE spff.auth_sessions

    SET last_seen_at = now()

    WHERE
      session_id = $1

      AND last_seen_at
        < now()
          - interval '5 minutes'
    `,
    [
      row.session_id,
    ],
  ).catch(
    (
      error: unknown,
    ) =>
      console.error(
        'Failed to update session last_seen_at',
        error,
      ),
  );


  return {
    user:
      toAuthUser(row),

    sessionId:
      row.session_id,

    csrfHash:
      row.csrf_hash,
  };
}


export async function revokeSession(
  sessionId: string,
): Promise<void> {

  await pool.query(
    `
    UPDATE spff.auth_sessions

    SET revoked_at =
      COALESCE(
        revoked_at,
        now()
      )

    WHERE session_id = $1
    `,
    [
      sessionId,
    ],
  );
}


export async function listUsers():
Promise<ManagedUser[]> {

  const result =
    await pool.query<UserRow>(
      `
      SELECT
        user_id,
        username,
        display_name,
        password_hash,
        role,
        enabled,
        failed_login_count,
        locked_until,
        last_login_at,
        created_at,
        updated_at

      FROM spff.app_users

      ORDER BY
        role,
        username
      `,
    );


  return result.rows.map(
    toManagedUser,
  );
}


export async function createUser(
  input: {
    username: string;
    displayName: string;
    password: string;
    role: AppRole;
  },
): Promise<ManagedUser> {

  const username =
    normalizeUsername(
      input.username,
    );


  if (
    !isValidUsername(
      username,
    )
  ) {
    throw new Error(
      'USERNAME_INVALID',
    );
  }


  if (
    !input.displayName.trim()
    || input.displayName
      .trim()
      .length > 80
  ) {
    throw new Error(
      'DISPLAY_NAME_INVALID',
    );
  }


  if (
    !isValidPassword(
      input.password,
    )
  ) {
    throw new Error(
      'PASSWORD_INVALID',
    );
  }


  if (
    ![
      'admin',
      'operator',
    ].includes(
      input.role,
    )
  ) {
    throw new Error(
      'ROLE_INVALID',
    );
  }


  const passwordHash =
    await hashPassword(
      input.password,
    );


  try {

    const result =
      await pool.query<UserRow>(
        `
        INSERT INTO spff.app_users (
          user_id,
          username,
          display_name,
          password_hash,
          role
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5
        )
        RETURNING
          user_id,
          username,
          display_name,
          password_hash,
          role,
          enabled,
          failed_login_count,
          locked_until,
          last_login_at,
          created_at,
          updated_at
        `,
        [
          randomUUID(),

          username,

          input.displayName
            .trim(),

          passwordHash,

          input.role,
        ],
      );


    return toManagedUser(
      result.rows[0],
    );

  } catch (error) {

    if (
      error instanceof Error
      && 'code' in error
      && error.code === '23505'
    ) {
      throw new Error(
        'USERNAME_EXISTS',
      );
    }

    throw error;
  }
}


export async function countUsers():
Promise<number> {

  const result =
    await pool.query<{
      count: string;
    }>(
      `
      SELECT
        count(*)::text AS count
      FROM spff.app_users
      `,
    );

  return Number(
    result.rows[0]
      ?.count
    ?? 0,
  );
}


export async function updateUser(
  userId: string,

  input: {
    displayName?: string;

    role?: AppRole;

    enabled?: boolean;

    password?: string;
  },
): Promise<ManagedUser | null> {

  const client =
    await pool.connect();


  try {

    await client.query(
      'BEGIN',
    );


    const currentResult =
      await client.query<UserRow>(
        `
        SELECT
          user_id,
          username,
          display_name,
          password_hash,
          role,
          enabled,
          failed_login_count,
          locked_until,
          last_login_at,
          created_at,
          updated_at

        FROM spff.app_users

        WHERE user_id = $1

        FOR UPDATE
        `,
        [
          userId,
        ],
      );


    const current =
      currentResult.rows[0];


    if (!current) {

      await client.query(
        'ROLLBACK',
      );

      return null;
    }


    const nextRole =
      input.role
      ?? current.role;


    const nextEnabled =
      input.enabled
      ?? current.enabled;


    if (
      ![
        'admin',
        'operator',
      ].includes(
        nextRole,
      )
    ) {
      throw new Error(
        'ROLE_INVALID',
      );
    }


    const nextDisplayName =
      input.displayName
      === undefined

        ? current.display_name

        : input.displayName
          .trim();


    if (
      !nextDisplayName
      || nextDisplayName.length
        > 80
    ) {
      throw new Error(
        'DISPLAY_NAME_INVALID',
      );
    }


    if (
      current.role === 'admin'

      && current.enabled

      && (
        nextRole !== 'admin'
        || !nextEnabled
      )
    ) {

      const admins =
        await client.query<{
          count: string;
        }>(
          `
          SELECT
            count(*)::text
              AS count

          FROM spff.app_users

          WHERE
            role = 'admin'

            AND enabled = true

            AND user_id <> $1
          `,
          [
            userId,
          ],
        );


      if (
        Number(
          admins.rows[0]
            ?.count
          ?? 0,
        ) === 0
      ) {
        throw new Error(
          'LAST_ADMIN',
        );
      }
    }


    const passwordHash =
      input.password
      === undefined

        ? current.password_hash

        : await hashPassword(
            input.password,
          );


    const updated =
      await client.query<UserRow>(
        `
        UPDATE spff.app_users

        SET
          display_name = $2,

          role = $3,

          enabled = $4,

          password_hash = $5,

          failed_login_count =
            CASE
              WHEN $6
              THEN 0
              ELSE failed_login_count
            END,

          locked_until =
            CASE
              WHEN $6
              THEN NULL
              ELSE locked_until
            END

        WHERE user_id = $1

        RETURNING
          user_id,
          username,
          display_name,
          password_hash,
          role,
          enabled,
          failed_login_count,
          locked_until,
          last_login_at,
          created_at,
          updated_at
        `,
        [
          userId,

          nextDisplayName,

          nextRole,

          nextEnabled,

          passwordHash,

          input.password
            !== undefined,
        ],
      );


    if (
      !nextEnabled
      || input.password
        !== undefined
    ) {

      await client.query(
        `
        UPDATE spff.auth_sessions

        SET revoked_at =
          COALESCE(
            revoked_at,
            now()
          )

        WHERE user_id = $1
        `,
        [
          userId,
        ],
      );
    }


    await client.query(
      'COMMIT',
    );


    return toManagedUser(
      updated.rows[0],
    );

  } catch (error) {

    await client.query(
      'ROLLBACK',
    );

    throw error;

  } finally {

    client.release();
  }
}


export async function listAuditLogs(
  limit: number,
) {

  const safeLimit =
    Math.max(
      1,
      Math.min(
        limit,
        200,
      ),
    );


  const result =
    await pool.query<{
      audit_id: string;

      username: string;

      role:
        | AppRole
        | null;

      action: string;

      resource_type: string;

      resource_id:
        | string
        | null;

      success: boolean;

      http_method:
        | string
        | null;

      http_path:
        | string
        | null;

      http_status:
        | number
        | null;

      ip_address:
        | string
        | null;

      occurred_at: Date;

      metadata:
        | Record<string, unknown>
        | null;
    }>(
      `
      SELECT
        audit_id,
        username,
        role,
        action,
        resource_type,
        resource_id,
        success,
        http_method,
        http_path,
        http_status,
        host(ip_address)
          AS ip_address,
        occurred_at,
        metadata

      FROM spff.audit_logs

      ORDER BY
        occurred_at DESC

      LIMIT $1
      `,
      [
        safeLimit,
      ],
    );


  return result.rows.map(
    (row) => ({

      auditId:
        row.audit_id,

      username:
        row.username,

      role:
        row.role,

      action:
        row.action,

      resourceType:
        row.resource_type,

      resourceId:
        row.resource_id,

      success:
        row.success,

      method:
        row.http_method,

      path:
        row.http_path,

      status:
        row.http_status,

      ipAddress:
        row.ip_address,

      occurredAt:
        row.occurred_at
          .toISOString(),

      metadata:
        row.metadata,
    }),
  );
}