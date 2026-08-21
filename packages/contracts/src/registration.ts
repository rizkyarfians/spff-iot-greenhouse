import {
  z,
} from 'zod'


export const registerRequestSchema =
  z
    .object({
      username:
        z
          .string()
          .trim()
          .min(
            3,
            'Username minimal 3 karakter.',
          )
          .max(
            32,
            'Username maksimal 32 karakter.',
          )
          .regex(
            /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/,
            'Username hanya boleh berisi huruf, angka, titik, underscore, dan tanda minus.',
          ),

      displayName:
        z
          .string()
          .trim()
          .min(
            2,
            'Nama minimal 2 karakter.',
          )
          .max(
            100,
            'Nama maksimal 100 karakter.',
          ),

      password:
        z
          .string()
          .min(
            12,
            'Password minimal 12 karakter.',
          )
          .max(
            128,
            'Password maksimal 128 karakter.',
          ),
    })
    .strict()


export type RegisterRequest =
  z.infer<
    typeof registerRequestSchema
  >


export const registerResponseSchema =
  z
    .object({
      status:
        z.literal(
          'pending_approval',
        ),

      message:
        z.string(),
    })
    .strict()


export type RegisterResponse =
  z.infer<
    typeof registerResponseSchema
  >