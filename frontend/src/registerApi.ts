import type {
  RegisterRequest,
  RegisterResponse,
} from '@spff/contracts'


function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
  )
}


function readErrorMessage(
  payload: unknown,
): string {
  if (!isRecord(payload)) {
    return 'Registrasi gagal.'
  }


  const error =
    payload.error


  if (
    typeof error === 'string'
  ) {
    return error
  }


  const message =
    payload.message


  if (
    typeof message === 'string'
  ) {
    return message
  }


  return 'Registrasi gagal.'
}


function parseRegisterResponse(
  payload: unknown,
): RegisterResponse {
  if (!isRecord(payload)) {
    throw new Error(
      'Response registrasi tidak valid.',
    )
  }


  if (
    payload.status
    !== 'pending_approval'
  ) {
    throw new Error(
      'Response registrasi tidak valid.',
    )
  }


  if (
    typeof payload.message
    !== 'string'
  ) {
    throw new Error(
      'Response registrasi tidak valid.',
    )
  }


  return {
    status:
      'pending_approval',

    message:
      payload.message,
  }
}


export async function registerAccount(
  request: RegisterRequest,
): Promise<RegisterResponse> {
  const response =
    await fetch(
      '/api/auth/register',
      {
        method:
          'POST',

        credentials:
          'include',

        headers: {
          'Content-Type':
            'application/json',
        },

        body:
          JSON.stringify(
            request,
          ),
      },
    )


  let payload: unknown


  try {
    payload =
      await response.json()
  } catch {
    throw new Error(
      `HTTP ${response.status}`,
    )
  }


  if (!response.ok) {
    throw new Error(
      readErrorMessage(
        payload,
      ),
    )
  }


  return parseRegisterResponse(
    payload,
  )
}