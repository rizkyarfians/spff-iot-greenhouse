import type {
  Request,
  Response,
} from 'express'

import {
  registerRequestSchema,
  type RegisterResponse,
} from '@spff/contracts'

import {
  registerOperator,
  RegistrationError,
} from '../services/registrationService.js'


export async function registerController(
  req:
    Request,

  res:
    Response<
      RegisterResponse
      | {
          error:
            string
        }
    >,
): Promise<void> {
  const parsed =
    registerRequestSchema
      .safeParse(
        req.body,
      )


  if (
    !parsed.success
  ) {
    res
      .status(400)
      .json({
        error:
          parsed
            .error
            .issues[0]
            ?.message
          ?? 'Data registrasi tidak valid.',
      })

    return
  }


  try {
    await registerOperator(
      parsed.data,
    )


    res
      .status(201)
      .json({
        status:
          'pending_approval',

        message:
          'Registrasi berhasil. Akun menunggu persetujuan administrator.',
      })
  } catch (error) {
    if (
      error
      instanceof RegistrationError
    ) {
      if (
        error.code
        === 'USERNAME_EXISTS'
      ) {
        res
          .status(409)
          .json({
            error:
              error.message,
          })

        return
      }


      if (
        error.code
        === 'INVALID_USERNAME'
        || error.code
          === 'INVALID_DISPLAY_NAME'
        || error.code
          === 'INVALID_PASSWORD'
      ) {
        res
          .status(400)
          .json({
            error:
              error.message,
          })

        return
      }


      res
        .status(500)
        .json({
          error:
            'Registrasi gagal diproses.',
        })

      return
    }


    res
      .status(500)
      .json({
        error:
          'Registrasi gagal diproses.',
      })
  }
}