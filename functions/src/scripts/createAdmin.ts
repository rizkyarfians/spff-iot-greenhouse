import 'dotenv/config'
import {
  countUsers,
  createUser,
  isValidPassword,
  isValidUsername,
} from '../services/authService.js'

import {
  createInterface,
} from 'node:readline/promises'

import {
  stdin as input,
  stdout as output,
} from 'node:process'


const rl =
  createInterface({
    input,
    output,
  })


async function main():
Promise<void> {
  console.log('')
  console.log(
    '====================================',
  )
  console.log(
    ' SPFF - Bootstrap Local Admin',
  )
  console.log(
    '====================================',
  )
  console.log('')


  const existingUsers =
    await countUsers()


  if (
    existingUsers > 0
  ) {
    console.error(
      `Bootstrap dibatalkan: sudah ada ${existingUsers} user di database.`,
    )

    console.error(
      'Admin tambahan harus dibuat melalui menu Manajemen User.',
    )

    process.exitCode =
      1

    return
  }


  const username =
    (
      await rl.question(
        'Username admin: ',
      )
    )
      .trim()
      .toLowerCase()


  if (
    !isValidUsername(
      username,
    )
  ) {
    console.error('')
    console.error(
      'Username tidak valid.',
    )

    console.error(
      'Gunakan format username yang didukung sistem SPFF.',
    )

    process.exitCode =
      1

    return
  }


  const displayName =
    (
      await rl.question(
        'Nama admin: ',
      )
    ).trim()


  if (
    displayName.length < 2
  ) {
    console.error('')
    console.error(
      'Nama admin minimal 2 karakter.',
    )

    process.exitCode =
      1

    return
  }


  const password =
    await rl.question(
      'Password admin: ',
    )


  if (
    !isValidPassword(
      password,
    )
  ) {
    console.error('')
    console.error(
      'Password tidak memenuhi policy password SPFF.',
    )

    process.exitCode =
      1

    return
  }


  const confirmation =
    await rl.question(
      'Ulangi password: ',
    )


  if (
    password !== confirmation
  ) {
    console.error('')
    console.error(
      'Konfirmasi password tidak sama.',
    )

    process.exitCode =
      1

    return
  }


  const admin =
    await createUser({
      username,
      displayName,
      password,
      role:
        'admin',
    })


  console.log('')
  console.log(
    '====================================',
  )
  console.log(
    ' Admin berhasil dibuat',
  )
  console.log(
    '====================================',
  )

  console.log(
    `Username : ${admin.username}`,
  )

  console.log(
    `Nama     : ${admin.displayName}`,
  )

  console.log(
    `Role     : ${admin.role}`,
  )

  console.log(
    `Enabled  : ${admin.enabled}`,
  )

  console.log('')
  console.log(
    'Admin sekarang bisa digunakan untuk login dashboard SPFF.',
  )
}


try {
  await main()
} catch (error) {
  console.error('')
  console.error(
    'Gagal membuat admin SPFF.',
  )


  if (
    error instanceof Error
  ) {
    console.error(
      error.message,
    )
  } else {
    console.error(
      error,
    )
  }


  process.exitCode =
    1
} finally {
  rl.close()
}


if (
  process.exitCode
  !== 1
) {
  process.exitCode =
    0
}