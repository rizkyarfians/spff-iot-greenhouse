import 'dotenv/config'

import {
  randomUUID,
} from 'node:crypto'

import {
  Pool,
} from 'pg'

import type {
  RegisterRequest,
} from '@spff/contracts'

import {
  hashPassword,
  isValidPassword,
  isValidUsername,
} from './authService.js'


export type RegistrationErrorCode =
  | 'INVALID_USERNAME'
  | 'INVALID_DISPLAY_NAME'
  | 'INVALID_PASSWORD'
  | 'USERNAME_EXISTS'
  | 'DATABASE_ERROR'


export class RegistrationError
  extends Error {
  readonly code:
    RegistrationErrorCode

  constructor(
    code:
      RegistrationErrorCode,

    message:
      string,
  ) {
    super(message)

    this.name =
      'RegistrationError'

    this.code =
      code
  }
}


const requiredEnv =
  (
    name:
      string,
  ): string => {
    const value =
      process.env[name]

    if (
      typeof value
        !== 'string'
      || value.length === 0
    ) {
      throw new Error(
        `Environment variable ${name} belum diisi.`,
      )
    }

    return value
  }


let pool:
Pool | null = null


const getPool =
  (): Pool => {
    if (pool) {
      return pool
    }


    const portRaw =
      process.env.PGPORT
      ?? '5432'

    const port =
      Number(portRaw)


    if (
      !Number.isInteger(port)
      || port <= 0
      || port > 65535
    ) {
      throw new Error(
        'PGPORT tidak valid.',
      )
    }


    pool =
      new Pool({
        host:
          requiredEnv(
            'PGHOST',
          ),

        port,

        database:
          requiredEnv(
            'PGDATABASE',
          ),

        user:
          requiredEnv(
            'PGUSER',
          ),

        password:
          requiredEnv(
            'PGPASSWORD',
          ),

        max:
          2,

        idleTimeoutMillis:
          30_000,

        connectionTimeoutMillis:
          5_000,
      })


    return pool
  }


const postgresErrorCode =
  (
    error:
      unknown,
  ): string | null => {
    if (
      typeof error
        !== 'object'
      || error === null
      || !(
        'code'
        in error
      )
    ) {
      return null
    }


    const code =
      (
        error as {
          code?:
            unknown
        }
      ).code


    return typeof code
      === 'string'
        ? code
        : null
  }


export async function registerOperator(
  input:
    RegisterRequest,
): Promise<void> {
  const username =
    input
      .username
      .trim()
      .toLowerCase()


  const displayName =
    input
      .displayName
      .trim()


  const password =
    input.password


  if (
    !isValidUsername(
      username,
    )
  ) {
    throw new RegistrationError(
      'INVALID_USERNAME',
      'Username tidak valid.',
    )
  }


  if (
    displayName.length < 2
    || displayName.length > 100
  ) {
    throw new RegistrationError(
      'INVALID_DISPLAY_NAME',
      'Nama harus berisi 2 sampai 100 karakter.',
    )
  }


  if (
    !isValidPassword(
      password,
    )
  ) {
    throw new RegistrationError(
      'INVALID_PASSWORD',
      'Password harus berisi 12 sampai 128 karakter.',
    )
  }


  const passwordHash =
    await hashPassword(
      password,
    )


  const userId =
    randomUUID()


  try {
    await getPool()
      .query(
        `
          INSERT INTO spff.app_users (
            user_id,
            username,
            display_name,
            password_hash,
            role,
            enabled
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            'operator',
            false
          )
        `,
        [
          userId,
          username,
          displayName,
          passwordHash,
        ],
      )
  } catch (error) {
    if (
      postgresErrorCode(
        error,
      )
      === '23505'
    ) {
      throw new RegistrationError(
        'USERNAME_EXISTS',
        'Username sudah digunakan.',
      )
    }


    throw new RegistrationError(
      'DATABASE_ERROR',
      'Registrasi gagal disimpan ke database.',
    )
  }
}