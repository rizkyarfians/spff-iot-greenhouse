import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import {
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
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
  deleteUser,
  fetchUsers,
  updateUser,
} from './api'

import {
  useAuth,
} from './authContext'

import './UserManagementPage.css'


export function UserManagementPage() {
  const { user } =
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
    passwordTarget,
    setPasswordTarget,
  ] =
    useState<ManagedUser | null>(
      null,
    )

  const [
    newPassword,
    setNewPassword,
  ] =
    useState('')

  const [
    deletingUserId,
    setDeletingUserId,
  ] =
    useState<string | null>(
      null,
    )


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


  const changeRole =
    async (
      target: ManagedUser,
      role: AppRole,
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
      target: ManagedUser,
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

      if (!passwordTarget) {
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

  const removeUser =
    async (
      target: ManagedUser,
    ) => {

      if (
        target.userId
        === user.userId
      ) {
        setNotice(
          'Akun yang sedang digunakan tidak dapat dihapus.',
        )

        return
      }


      const confirmed =
        window.confirm(
          `Hapus akun @${target.username} secara permanen?\n\nSemua sesi login akun ini akan dihentikan. Tindakan ini tidak dapat dibatalkan.`,
        )


      if (!confirmed) {
        return
      }


      setNotice('')
      setDeletingUserId(
        target.userId,
      )


      try {
        await deleteUser(
          target.userId,
        )


        setUsers(
          (current) =>
            current.filter(
              (candidate) =>
                candidate.userId
                !== target.userId,
            ),
        )


        if (
          passwordTarget
            ?.userId
          === target.userId
        ) {
          setPasswordTarget(null)
          setNewPassword('')
        }


        setNotice(
          `Akun ${target.username} berhasil dihapus.`,
        )

      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'Akun gagal dihapus.',
        )
      } finally {
        setDeletingUserId(null)
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
            aria-hidden="true"
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
    <section
      className="um-page"
      aria-label="Manajemen user"
    >
      <div className="um-summary-grid">
        <article className="um-summary-card">
          <div className="um-summary-icon">
            <Users
              size={22}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </div>

          <div className="um-summary-copy">
            <span>
              Total User
            </span>

            <strong>
              {users.length}
            </strong>

            <small>
              Semua akun terdaftar
            </small>
          </div>
        </article>


        <article className="um-summary-card">
          <div className="um-summary-icon">
            <ShieldCheck
              size={22}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </div>

          <div className="um-summary-copy">
            <span>
              Admin Aktif
            </span>

            <strong>
              {adminCount}
            </strong>

            <small>
              Administrator sistem
            </small>
          </div>
        </article>


        <article className="um-summary-card">
          <div className="um-summary-icon">
            <UserCheck
              size={22}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </div>

          <div className="um-summary-copy">
            <span>
              Operator Aktif
            </span>

            <strong>
              {operatorCount}
            </strong>

            <small>
              Operator yang dapat login
            </small>
          </div>
        </article>


        <article className="um-summary-card">
          <div className="um-summary-icon um-summary-icon--pending">
            <UserX
              size={22}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </div>

          <div className="um-summary-copy">
            <span>
              Menunggu Aktivasi
            </span>

            <strong>
              {pendingCount}
            </strong>

            <small>
              Registrasi belum diaktifkan
            </small>
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


      <article className="um-card um-list-card">
        <div className="um-list-heading">
          <div>

            <h2>
              User Terdaftar
            </h2>

            <p>
              Kelola role, aktivasi,
              dan password user.
              Akun operator baru dibuat
              melalui halaman registrasi.
            </p>
          </div>


          <div className="um-list-meta">
            {
              pendingCount > 0
              && (
                <span className="um-pending-chip">
                  {pendingCount}
                  {' '}
                  perlu aktivasi
                </span>
              )
            }

            <span className="um-user-count">
              {users.length}
              {' '}
              akun
            </span>

            <button
              className="um-button um-button--outline"
              type="button"
              disabled={loading}
              onClick={() =>
                void loadUsers()
              }
            >
              <RefreshCw
                size={14}
                strokeWidth={1.9}
                aria-hidden="true"
              />

              Refresh
            </button>
          </div>
        </div>


        {
          loading
            ? (
                <div className="um-empty">
                  <div className="um-loading-dot" />

                  <span>
                    Memuat daftar user...
                  </span>
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
                          <th>User</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Aksi</th>
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
                                                    strokeWidth={1.8}
                                                    aria-hidden="true"
                                                  />

                                                  Nonaktifkan
                                                </>
                                              )
                                            : (
                                                <>
                                                  <UserCheck
                                                    size={15}
                                                    strokeWidth={1.8}
                                                    aria-hidden="true"
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
                                          strokeWidth={1.8}
                                          aria-hidden="true"
                                        />

                                        Password
                                      </button>

                                      <button
                                        className="um-button um-button--delete"
                                        type="button"
                                        disabled={
                                          isCurrentUser
                                          || deletingUserId
                                            !== null
                                        }
                                        title={
                                          isCurrentUser
                                            ? 'Akun yang sedang digunakan tidak dapat dihapus'
                                            : `Hapus akun ${target.username}`
                                        }
                                        onClick={() =>
                                          void removeUser(
                                            target,
                                          )
                                        }
                                      >
                                        <Trash2
                                          size={15}
                                          strokeWidth={1.8}
                                          aria-hidden="true"
                                        />

                                        {
                                          deletingUserId
                                          === target.userId
                                            ? 'Menghapus...'
                                            : 'Hapus'
                                        }
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


      {
        passwordTarget
        && (
          <article className="um-password-card">
            <div className="um-password-heading">
              <div className="um-heading-icon">
                <UserRoundCog
                  size={20}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </div>

              <div>
                <span className="um-section-eyebrow">
                  Keamanan akun
                </span>

                <h3>
                  Reset Password
                </h3>

                <p>
                  Ubah password untuk
                  {' '}
                  <strong>
                    @{passwordTarget.username}
                  </strong>
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
