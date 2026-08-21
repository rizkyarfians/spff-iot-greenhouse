import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import {
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserRoundCog,
  UserX,
  Users,
} from 'lucide-react'

import type {
  AppRole,
  ManagedUser,
} from './api'

import {
  createUser,
  fetchUsers,
  updateUser,
} from './api'

import {
  useAuth,
} from './authContext'

import './UserManagementPage.css'


type CreateUserForm = {
  username: string
  displayName: string
  password: string
  role: AppRole
}


const emptyCreateForm:
CreateUserForm = {
  username: '',
  displayName: '',
  password: '',
  role: 'operator',
}


export function UserManagementPage() {
  const {
    user,
  } =
    useAuth()


  const [
    users,
    setUsers,
  ] =
    useState<ManagedUser[]>([])


  const [
    loading,
    setLoading,
  ] =
    useState(true)


  const [
    notice,
    setNotice,
  ] =
    useState('')


  const [
    createForm,
    setCreateForm,
  ] =
    useState<CreateUserForm>(
      emptyCreateForm,
    )


  const [
    passwordTarget,
    setPasswordTarget,
  ] =
    useState<
      ManagedUser | null
    >(null)


  const [
    newPassword,
    setNewPassword,
  ] =
    useState('')


  const loadUsers =
    useCallback(
      async () => {
        setLoading(true)
        setNotice('')

        try {
          const result =
            await fetchUsers()

          setUsers(result)
        } catch (error) {
          setNotice(
            error instanceof Error
              ? error.message
              : 'Daftar user gagal dimuat.',
          )
        } finally {
          setLoading(false)
        }
      },
      [],
    )


  useEffect(
    () => {
      if (
        user.role !== 'admin'
      ) {
        return
      }

      void loadUsers()
    },
    [
      user.role,
      loadUsers,
    ],
  )


  const submitUser =
    async (
      event:
        FormEvent<HTMLFormElement>,
    ) => {
      event.preventDefault()

      const username =
        createForm
          .username
          .trim()

      const displayName =
        createForm
          .displayName
          .trim()

      const password =
        createForm.password


      if (
        !username
        || !displayName
        || !password
      ) {
        setNotice(
          'Nama, username, dan password wajib diisi.',
        )

        return
      }


      if (
        password.length < 12
        || password.length > 128
      ) {
        setNotice(
          'Password harus berisi 12 sampai 128 karakter.',
        )

        return
      }


      setNotice('')


      try {
        await createUser({
          username,
          displayName,
          password,
          role:
            createForm.role,
        })


        setCreateForm(
          emptyCreateForm,
        )


        setNotice(
          'User berhasil dibuat.',
        )


        await loadUsers()
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'User gagal dibuat.',
        )
      }
    }


  const changeRole =
    async (
      target:
        ManagedUser,

      role:
        AppRole,
    ) => {
      if (
        target.userId
        === user.userId
      ) {
        setNotice(
          'Role akun yang sedang digunakan tidak dapat diubah.',
        )

        return
      }


      setNotice('')


      try {
        await updateUser(
          target.userId,
          {
            role,
          },
        )


        setNotice(
          `Role ${target.username} berhasil diperbarui.`,
        )


        await loadUsers()
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'Role gagal diperbarui.',
        )
      }
    }


  const toggleEnabled =
    async (
      target:
        ManagedUser,
    ) => {
      if (
        target.userId
        === user.userId
      ) {
        setNotice(
          'Akun yang sedang digunakan tidak dapat dinonaktifkan.',
        )

        return
      }


      setNotice('')


      try {
        await updateUser(
          target.userId,
          {
            enabled:
              !target.enabled,
          },
        )


        setNotice(
          target.enabled
            ? `${target.username} dinonaktifkan.`
            : `${target.username} berhasil diaktifkan.`,
        )


        await loadUsers()
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'Status user gagal diperbarui.',
        )
      }
    }


  const submitPassword =
    async (
      event:
        FormEvent<HTMLFormElement>,
    ) => {
      event.preventDefault()


      if (
        !passwordTarget
      ) {
        return
      }


      if (
        newPassword.length < 12
        || newPassword.length > 128
      ) {
        setNotice(
          'Password harus berisi 12 sampai 128 karakter.',
        )

        return
      }


      setNotice('')


      try {
        await updateUser(
          passwordTarget.userId,
          {
            password:
              newPassword,
          },
        )


        setNotice(
          `Password ${passwordTarget.username} berhasil diperbarui.`,
        )


        setPasswordTarget(null)
        setNewPassword('')


        await loadUsers()
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'Password gagal diperbarui.',
        )
      }
    }


  if (
    user.role !== 'admin'
  ) {
    return (
      <section className="um-page">
        <div className="um-denied">
          <ShieldCheck
            size={30}
            strokeWidth={1.8}
          />

          <div>
            <h2>
              Akses Ditolak
            </h2>

            <p>
              Manajemen user hanya dapat
              diakses administrator.
            </p>
          </div>
        </div>
      </section>
    )
  }


  const pendingCount =
    users.filter(
      (target) =>
        !target.enabled,
    ).length


  const adminCount =
    users.filter(
      (target) =>
        target.enabled
        && target.role === 'admin',
    ).length


  const operatorCount =
    users.filter(
      (target) =>
        target.enabled
        && target.role === 'operator',
    ).length


  return (
    <section className="um-page">
      <header className="um-page-header">
        <div>
          <span className="um-eyebrow">
            Administrasi
          </span>

          <h1>
            Manajemen User
          </h1>

          <p>
            Kelola akun admin dan operator
            dashboard lokal SPFF.
          </p>
        </div>


        <button
          className="um-button um-button--outline"
          type="button"
          disabled={loading}
          onClick={() =>
            void loadUsers()
          }
        >
          <RefreshCw
            size={16}
            strokeWidth={1.9}
          />

          Refresh
        </button>
      </header>


      <div className="um-summary-grid">
        <article className="um-summary-card">
          <div className="um-summary-icon">
            <Users
              size={21}
              strokeWidth={1.8}
            />
          </div>

          <div>
            <span>
              Total User
            </span>

            <strong>
              {users.length}
            </strong>
          </div>
        </article>


        <article className="um-summary-card">
          <div className="um-summary-icon">
            <ShieldCheck
              size={21}
              strokeWidth={1.8}
            />
          </div>

          <div>
            <span>
              Admin Aktif
            </span>

            <strong>
              {adminCount}
            </strong>
          </div>
        </article>


        <article className="um-summary-card">
          <div className="um-summary-icon">
            <UserCheck
              size={21}
              strokeWidth={1.8}
            />
          </div>

          <div>
            <span>
              Operator Aktif
            </span>

            <strong>
              {operatorCount}
            </strong>
          </div>
        </article>


        <article className="um-summary-card">
          <div className="um-summary-icon um-summary-icon--pending">
            <UserX
              size={21}
              strokeWidth={1.8}
            />
          </div>

          <div>
            <span>
              Menunggu Aktivasi
            </span>

            <strong>
              {pendingCount}
            </strong>
          </div>
        </article>
      </div>


      {
        notice
        && (
          <div
            className="um-notice"
            role="status"
          >
            {notice}
          </div>
        )
      }


      <div className="um-content-grid">
        <article className="um-card um-create-card">
          <div className="um-card-heading">
            <div className="um-heading-icon">
              <Plus
                size={19}
                strokeWidth={1.9}
              />
            </div>

            <div>
              <h2>
                Tambah User
              </h2>

              <p>
                Buat akun admin atau operator
                secara manual.
              </p>
            </div>
          </div>


          <form
            className="um-create-form"
            onSubmit={
              submitUser
            }
          >
            <label className="um-field">
              <span>
                Nama
              </span>

              <input
                type="text"
                value={
                  createForm.displayName
                }
                onChange={(event) =>
                  setCreateForm(
                    (current) => ({
                      ...current,

                      displayName:
                        event.target.value,
                    }),
                  )
                }
                placeholder="Nama lengkap"
                required
              />
            </label>


            <label className="um-field">
              <span>
                Username
              </span>

              <input
                type="text"
                autoComplete="off"
                value={
                  createForm.username
                }
                onChange={(event) =>
                  setCreateForm(
                    (current) => ({
                      ...current,

                      username:
                        event.target.value,
                    }),
                  )
                }
                placeholder="contoh: operator01"
                required
              />
            </label>


            <label className="um-field">
              <span>
                Password
              </span>

              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={
                  createForm.password
                }
                onChange={(event) =>
                  setCreateForm(
                    (current) => ({
                      ...current,

                      password:
                        event.target.value,
                    }),
                  )
                }
                placeholder="Minimal 12 karakter"
                required
              />

              <small>
                12–128 karakter.
              </small>
            </label>


            <label className="um-field">
              <span>
                Role
              </span>

              <select
                value={
                  createForm.role
                }
                onChange={(event) => {
                  const role:
                  AppRole =
                    event.target.value
                    === 'admin'
                      ? 'admin'
                      : 'operator'


                  setCreateForm(
                    (current) => ({
                      ...current,
                      role,
                    }),
                  )
                }}
              >
                <option value="operator">
                  Operator
                </option>

                <option value="admin">
                  Admin
                </option>
              </select>
            </label>


            <button
              className="um-button um-button--primary um-create-submit"
              type="submit"
            >
              <Plus
                size={17}
                strokeWidth={2}
              />

              Tambah User
            </button>
          </form>
        </article>


        <article className="um-card um-list-card">
          <div className="um-card-heading um-list-heading">
            <div>
              <h2>
                User Terdaftar
              </h2>

              <p>
                Kelola role, aktivasi,
                dan password user.
              </p>
            </div>

            <span className="um-user-count">
              {users.length} akun
            </span>
          </div>


          {
            loading
              ? (
                  <div className="um-empty">
                    Memuat daftar user...
                  </div>
                )

              : users.length === 0
                ? (
                    <div className="um-empty">
                      Belum ada user terdaftar.
                    </div>
                  )

                : (
                    <div className="um-table-wrap">
                      <table className="um-table">
                        <thead>
                          <tr>
                            <th>
                              User
                            </th>

                            <th>
                              Role
                            </th>

                            <th>
                              Status
                            </th>

                            <th>
                              Aksi
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {
                            users.map(
                              (target) => {
                                const isCurrentUser =
                                  target.userId
                                  === user.userId


                                return (
                                  <tr
                                    key={
                                      target.userId
                                    }
                                  >
                                    <td>
                                      <div className="um-identity">
                                        <div className="um-avatar">
                                          {
                                            target
                                              .displayName
                                              .slice(
                                                0,
                                                1,
                                              )
                                              .toUpperCase()
                                          }
                                        </div>

                                        <div className="um-identity-copy">
                                          <strong>
                                            {
                                              target.displayName
                                            }

                                            {
                                              isCurrentUser
                                              && (
                                                <span className="um-you">
                                                  Anda
                                                </span>
                                              )
                                            }
                                          </strong>

                                          <small>
                                            @{target.username}
                                          </small>
                                        </div>
                                      </div>
                                    </td>


                                    <td>
                                      <select
                                        className="um-role-select"
                                        value={
                                          target.role
                                        }
                                        disabled={
                                          isCurrentUser
                                        }
                                        aria-label={
                                          `Role ${target.username}`
                                        }
                                        onChange={(event) => {
                                          const role:
                                          AppRole =
                                            event.target.value
                                            === 'admin'
                                              ? 'admin'
                                              : 'operator'


                                          void changeRole(
                                            target,
                                            role,
                                          )
                                        }}
                                      >
                                        <option value="operator">
                                          Operator
                                        </option>

                                        <option value="admin">
                                          Admin
                                        </option>
                                      </select>
                                    </td>


                                    <td>
                                      <span
                                        className={
                                          target.enabled
                                            ? 'um-status um-status--active'
                                            : 'um-status um-status--pending'
                                        }
                                      >
                                        {
                                          target.enabled
                                            ? 'Aktif'
                                            : 'Menunggu Aktivasi'
                                        }
                                      </span>
                                    </td>


                                    <td>
                                      <div className="um-actions">
                                        <button
                                          className={
                                            target.enabled
                                              ? 'um-button um-button--danger-soft'
                                              : 'um-button um-button--success-soft'
                                          }
                                          type="button"
                                          disabled={
                                            isCurrentUser
                                          }
                                          onClick={() =>
                                            void toggleEnabled(
                                              target,
                                            )
                                          }
                                        >
                                          {
                                            target.enabled
                                              ? (
                                                  <>
                                                    <UserX
                                                      size={15}
                                                    />

                                                    Nonaktifkan
                                                  </>
                                                )

                                              : (
                                                  <>
                                                    <UserCheck
                                                      size={15}
                                                    />

                                                    Aktifkan
                                                  </>
                                                )
                                          }
                                        </button>


                                        <button
                                          className="um-button um-button--outline"
                                          type="button"
                                          onClick={() => {
                                            setPasswordTarget(
                                              target,
                                            )

                                            setNewPassword('')
                                          }}
                                        >
                                          <KeyRound
                                            size={15}
                                          />

                                          Password
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              },
                            )
                          }
                        </tbody>
                      </table>
                    </div>
                  )
          }
        </article>
      </div>


      {
        passwordTarget
        && (
          <article className="um-password-card">
            <div className="um-password-heading">
              <div className="um-heading-icon">
                <UserRoundCog
                  size={19}
                  strokeWidth={1.8}
                />
              </div>

              <div>
                <h3>
                  Reset Password
                </h3>

                <p>
                  @{passwordTarget.username}
                </p>
              </div>
            </div>


            <form
              className="um-password-form"
              onSubmit={
                submitPassword
              }
            >
              <input
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                placeholder="Password baru, minimal 12 karakter"
                value={
                  newPassword
                }
                onChange={(event) =>
                  setNewPassword(
                    event.target.value,
                  )
                }
                required
              />


              <button
                className="um-button um-button--outline"
                type="button"
                onClick={() => {
                  setPasswordTarget(null)
                  setNewPassword('')
                }}
              >
                Batal
              </button>


              <button
                className="um-button um-button--primary"
                type="submit"
              >
                Simpan Password
              </button>
            </form>
          </article>
        )
      }
    </section>
  )
}