import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Leaf,
  LockKeyhole,
  ShieldCheck,
  Sprout,
  UserRound,
} from 'lucide-react'

import type {
  AuthUser,
} from './api'

import {
  fetchCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
} from './api'

import {
  registerAccount,
} from './registerApi'

import {
  AuthContext,
  type AuthContextValue,
} from './authContext'

import './AuthGate.css'


type AuthGateProps = {
  children: ReactNode
}


type AuthMode =
  | 'login'
  | 'register'


type LoginForm = {
  username: string
  password: string
}


type RegisterForm = {
  username: string
  displayName: string
  password: string
  confirmPassword: string
}


const emptyLoginForm:
LoginForm = {
  username: '',
  password: '',
}


const emptyRegisterForm:
RegisterForm = {
  username: '',
  displayName: '',
  password: '',
  confirmPassword: '',
}


function AuthVisual() {
  return (
    <aside
      className="auth-visual"
      aria-label="Smart Fertigasi"
    >
      <div
        className="auth-visual-background"
        aria-hidden="true"
      />

      <div
        className="auth-visual-overlay"
        aria-hidden="true"
      />

      <div className="auth-visual-top">
        <span className="auth-visual-system">
          <span className="auth-online-dot" />

          SPFF Auto Hidro
        </span>
      </div>

      <div className="auth-visual-content">
        <div className="auth-visual-chip">
          <ShieldCheck
            size={14}
            strokeWidth={2}
            aria-hidden="true"
          />

        </div>

       

    

        <div className="auth-visual-features">
          <div className="auth-visual-feature">
            <span className="auth-feature-icon">
              <Sprout
                size={17}
                strokeWidth={1.9}
                aria-hidden="true"
              />
            </span>

            <div>
              <strong>
                Sensor Monitoring
              </strong>

              <span>
                NPK, EC, pH, suhu,
                kelembapan, flow dan level.
              </span>
            </div>
          </div>

          <div className="auth-visual-feature">
            <span className="auth-feature-icon">
              <Leaf
                size={17}
                strokeWidth={1.9}
                aria-hidden="true"
              />
            </span>

            <div>
              <strong>
                Smart Farming
              </strong>

              <span>
                Data lokal terintegrasi
                dengan kontrol fertigasi.
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}


export function AuthGate({
  children,
}: AuthGateProps) {
  const [
    initialized,
    setInitialized,
  ] =
    useState(false)


  const [
    user,
    setUser,
  ] =
    useState<
      AuthUser | null
    >(null)


  const [
    authMode,
    setAuthMode,
  ] =
    useState<AuthMode>(
      'login',
    )


  const [
    loginForm,
    setLoginForm,
  ] =
    useState<LoginForm>(
      emptyLoginForm,
    )


  const [
    loginLoading,
    setLoginLoading,
  ] =
    useState(false)


  const [
    loginNotice,
    setLoginNotice,
  ] =
    useState('')


  const [
    registerForm,
    setRegisterForm,
  ] =
    useState<RegisterForm>(
      emptyRegisterForm,
    )


  const [
    registerLoading,
    setRegisterLoading,
  ] =
    useState(false)


  const [
    registerNotice,
    setRegisterNotice,
  ] =
    useState('')


  const [
    showLoginPassword,
    setShowLoginPassword,
  ] =
    useState(false)


  const [
    showRegisterPassword,
    setShowRegisterPassword,
  ] =
    useState(false)


  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] =
    useState(false)


  useEffect(
    () => {
      let mounted =
        true


      const bootstrapAuth =
        async () => {
          try {
            const currentUser =
              await fetchCurrentUser()


            if (
              mounted
            ) {
              setUser(
                currentUser,
              )
            }
          } catch {
            if (
              mounted
            ) {
              setUser(
                null,
              )
            }
          } finally {
            if (
              mounted
            ) {
              setInitialized(
                true,
              )
            }
          }
        }


      void bootstrapAuth()


      return () => {
        mounted =
          false
      }
    },
    [],
  )


  const showLogin =
    () => {
      setAuthMode(
        'login',
      )


      setRegisterNotice(
        '',
      )


      setShowRegisterPassword(
        false,
      )


      setShowConfirmPassword(
        false,
      )
    }


  const showRegister =
    () => {
      setAuthMode(
        'register',
      )


      setLoginNotice(
        '',
      )


      setRegisterNotice(
        '',
      )


      setShowLoginPassword(
        false,
      )
    }


  const submitLogin =
    async (
      event:
        FormEvent<HTMLFormElement>,
    ) => {
      event.preventDefault()


      if (
        loginLoading
      ) {
        return
      }


      const username =
        loginForm
          .username
          .trim()


      const password =
        loginForm.password


      if (
        !username
        || !password
      ) {
        setLoginNotice(
          'Username dan password wajib diisi.',
        )


        return
      }


      setLoginLoading(
        true,
      )


      setLoginNotice(
        '',
      )


      try {
        const loggedInUser =
          await loginRequest({
            username,
            password,
          })


        setUser(
          loggedInUser,
        )


        setLoginForm(
          emptyLoginForm,
        )
      } catch (error) {
        setLoginNotice(
          error instanceof Error
            ? error.message
            : 'Login gagal.',
        )
      } finally {
        setLoginLoading(
          false,
        )
      }
    }


  const submitRegister =
    async (
      event:
        FormEvent<HTMLFormElement>,
    ) => {
      event.preventDefault()


      if (
        registerLoading
      ) {
        return
      }


      const username =
        registerForm
          .username
          .trim()


      const displayName =
        registerForm
          .displayName
          .trim()


      const password =
        registerForm.password


      const confirmPassword =
        registerForm
          .confirmPassword


      if (
        !username
        || !displayName
        || !password
        || !confirmPassword
      ) {
        setRegisterNotice(
          'Semua field wajib diisi.',
        )


        return
      }


      if (
        username.length < 3
      ) {
        setRegisterNotice(
          'Username minimal 3 karakter.',
        )


        return
      }


      if (
        displayName.length < 2
      ) {
        setRegisterNotice(
          'Nama minimal 2 karakter.',
        )


        return
      }


      if (
        password.length < 12
        || password.length > 128
      ) {
        setRegisterNotice(
          'Password harus berisi 12 sampai 128 karakter.',
        )


        return
      }


      if (
        password
        !== confirmPassword
      ) {
        setRegisterNotice(
          'Konfirmasi password tidak sama.',
        )


        return
      }


      setRegisterLoading(
        true,
      )


      setRegisterNotice(
        '',
      )


      try {
        const response =
          await registerAccount({
            username,
            displayName,
            password,
          })


        setRegisterForm(
          emptyRegisterForm,
        )


        setLoginForm({
          username,
          password: '',
        })


        setAuthMode(
          'login',
        )


        setShowRegisterPassword(
          false,
        )


        setShowConfirmPassword(
          false,
        )


        setLoginNotice(
          response.message,
        )
      } catch (error) {
        setRegisterNotice(
          error instanceof Error
            ? error.message
            : 'Registrasi gagal.',
        )
      } finally {
        setRegisterLoading(
          false,
        )
      }
    }


  const logout =
    useCallback(
      async () => {
        try {
          await logoutRequest()
        } finally {
          setUser(
            null,
          )


          setLoginForm(
            emptyLoginForm,
          )


          setAuthMode(
            'login',
          )


          setLoginNotice(
            '',
          )


          setRegisterNotice(
            '',
          )


          setShowLoginPassword(
            false,
          )


          setShowRegisterPassword(
            false,
          )


          setShowConfirmPassword(
            false,
          )
        }
      },
      [],
    )


  const context =
    useMemo<
      AuthContextValue | null
    >(
      () =>
        user
          ? {
              user,
              logout,
            }
          : null,
      [
        user,
        logout,
      ],
    )


  if (
    !initialized
  ) {
    return (
      <main className="auth-screen">
        <div className="auth-layout">
          <section className="auth-main">
            <div className="auth-brand">
              <span className="auth-brand-mark">
                <Leaf
                  size={20}
                  strokeWidth={2.1}
                  aria-hidden="true"
                />
              </span>

              <div className="auth-brand-copy">
                <strong>
                  SMART FERTIGASI
                </strong>

                <small>
                  Panel kontrol fertigasi
                </small>
              </div>
            </div>

            <div className="auth-content auth-loading-content">
              <div
                className="auth-loading-spinner"
                aria-hidden="true"
              />

              <span className="auth-eyebrow">
                Sistem Fertigasi
              </span>

              <h1>
                Menyiapkan dashboard
              </h1>

              <p>
                Memeriksa akun dan
                menyambungkan sistem
                fertigasi.
              </p>

              <div
                className="auth-loading-status"
                role="status"
              >
                <span className="auth-loading-pulse" />

                Menyambungkan data
                fertigasi
              </div>
            </div>

            <footer className="auth-footer">
              © {new Date().getFullYear()}
              {' '}
              SPFF · Smart Fertigasi
            </footer>
          </section>

          <AuthVisual />
        </div>
      </main>
    )
  }


  if (
    !user
    || !context
  ) {
    return (
      <main className="auth-screen">
        <div className="auth-layout">
          <section className="auth-main">
            <div className="auth-brand">
              <span className="auth-brand-mark">
                <Leaf
                  size={20}
                  strokeWidth={2.1}
                  aria-hidden="true"
                />
              </span>

              <div className="auth-brand-copy">
                <strong>
                  SMART FERTIGASI
                </strong>

                <small>
                  Panel kontrol fertigasi
                </small>
              </div>
            </div>


            <div className="auth-content">
              {
                authMode === 'login'
                  ? (
                      <>
                        <div className="auth-heading">
                          <span className="auth-eyebrow">
                            Selamat datang kembali
                          </span>

                          <h1>
                            Login
                          </h1>

                          <p>
                            Gunakan akun
                            anda untuk mengakses
                            monitoring, datalog,
                            dan kontrol fertigasi.
                          </p>
                        </div>


                        <form
                          className="auth-form"
                          onSubmit={
                            submitLogin
                          }
                        >
                          <label className="auth-field">
                            <span>
                              Username
                            </span>

                            <div className="auth-input">
                              <UserRound
                                size={17}
                                strokeWidth={1.8}
                                aria-hidden="true"
                              />

                              <input
                                type="text"
                                autoComplete="username"
                                placeholder="Masukkan username"
                                value={
                                  loginForm.username
                                }
                                onChange={(event) =>
                                  setLoginForm(
                                    (current) => ({
                                      ...current,

                                      username:
                                        event.target.value,
                                    }),
                                  )
                                }
                                disabled={
                                  loginLoading
                                }
                                required
                              />
                            </div>
                          </label>


                          <label className="auth-field">
                            <span>
                              Password
                            </span>

                            <div className="auth-input">
                              <LockKeyhole
                                size={17}
                                strokeWidth={1.8}
                                aria-hidden="true"
                              />

                              <input
                                type={
                                  showLoginPassword
                                    ? 'text'
                                    : 'password'
                                }
                                autoComplete="current-password"
                                placeholder="Masukkan password"
                                value={
                                  loginForm.password
                                }
                                onChange={(event) =>
                                  setLoginForm(
                                    (current) => ({
                                      ...current,

                                      password:
                                        event.target.value,
                                    }),
                                  )
                                }
                                disabled={
                                  loginLoading
                                }
                                required
                              />

                              <button
                                className="auth-password-toggle"
                                type="button"
                                aria-label={
                                  showLoginPassword
                                    ? 'Sembunyikan password'
                                    : 'Tampilkan password'
                                }
                                onClick={() =>
                                  setShowLoginPassword(
                                    (current) =>
                                      !current,
                                  )
                                }
                                disabled={
                                  loginLoading
                                }
                              >
                                {
                                  showLoginPassword
                                    ? (
                                        <EyeOff
                                          size={16}
                                          strokeWidth={1.8}
                                        />
                                      )
                                    : (
                                        <Eye
                                          size={16}
                                          strokeWidth={1.8}
                                        />
                                      )
                                }
                              </button>
                            </div>
                          </label>


                          {
                            loginNotice
                            && (
                              <p
                                className="auth-notice"
                                role="status"
                              >
                                {
                                  loginNotice
                                }
                              </p>
                            )
                          }


                          <button
                            className="auth-submit"
                            type="submit"
                            disabled={
                              loginLoading
                            }
                          >
                            <span>
                              {
                                loginLoading
                                  ? 'Memproses...'
                                  : 'Masuk'
                              }
                            </span>

                            {
                              !loginLoading
                              && (
                                <ArrowRight
                                  size={17}
                                  strokeWidth={2}
                                  aria-hidden="true"
                                />
                              )
                            }
                          </button>


                          <div className="auth-switch">
                            <span>
                              Belum memiliki akun?
                            </span>

                            <button
                              type="button"
                              onClick={
                                showRegister
                              }
                            >
                              Daftar sebagai operator
                            </button>
                          </div>
                        </form>
                      </>
                    )

                  : (
                      <>
                        <button
                          className="auth-back-button"
                          type="button"
                          onClick={
                            showLogin
                          }
                        >
                          <ArrowLeft
                            size={15}
                            strokeWidth={2}
                            aria-hidden="true"
                          />

                          Kembali ke login
                        </button>


                        <div className="auth-heading auth-heading--register">
                          <span className="auth-eyebrow">
                            Registrasi operator
                          </span>

                          <h1>
                            Buat akun baru
                          </h1>

                          <p>
                            Akun baru otomatis
                            memiliki role operator
                            dan harus diaktifkan
                            administrator sebelum
                            dapat digunakan.
                          </p>
                        </div>


                        <form
                          className="auth-form"
                          onSubmit={
                            submitRegister
                          }
                        >
                          <div className="auth-register-grid">
                            <label className="auth-field">
                              <span>
                                Nama
                              </span>

                              <div className="auth-input">
                                <UserRound
                                  size={17}
                                  strokeWidth={1.8}
                                  aria-hidden="true"
                                />

                                <input
                                  type="text"
                                  autoComplete="name"
                                  placeholder="Nama operator"
                                  value={
                                    registerForm.displayName
                                  }
                                  onChange={(event) =>
                                    setRegisterForm(
                                      (current) => ({
                                        ...current,

                                        displayName:
                                          event.target.value,
                                      }),
                                    )
                                  }
                                  disabled={
                                    registerLoading
                                  }
                                  required
                                />
                              </div>
                            </label>


                            <label className="auth-field">
                              <span>
                                Username
                              </span>

                              <div className="auth-input">
                                <UserRound
                                  size={17}
                                  strokeWidth={1.8}
                                  aria-hidden="true"
                                />

                                <input
                                  type="text"
                                  autoComplete="username"
                                  placeholder="Minimal 3 karakter"
                                  value={
                                    registerForm.username
                                  }
                                  onChange={(event) =>
                                    setRegisterForm(
                                      (current) => ({
                                        ...current,

                                        username:
                                          event.target.value,
                                      }),
                                    )
                                  }
                                  disabled={
                                    registerLoading
                                  }
                                  required
                                />
                              </div>
                            </label>
                          </div>


                          <label className="auth-field">
                            <span>
                              Password
                            </span>

                            <div className="auth-input">
                              <LockKeyhole
                                size={17}
                                strokeWidth={1.8}
                                aria-hidden="true"
                              />

                              <input
                                type={
                                  showRegisterPassword
                                    ? 'text'
                                    : 'password'
                                }
                                autoComplete="new-password"
                                minLength={12}
                                maxLength={128}
                                placeholder="12 sampai 128 karakter"
                                value={
                                  registerForm.password
                                }
                                onChange={(event) =>
                                  setRegisterForm(
                                    (current) => ({
                                      ...current,

                                      password:
                                        event.target.value,
                                    }),
                                  )
                                }
                                disabled={
                                  registerLoading
                                }
                                required
                              />

                              <button
                                className="auth-password-toggle"
                                type="button"
                                aria-label={
                                  showRegisterPassword
                                    ? 'Sembunyikan password'
                                    : 'Tampilkan password'
                                }
                                onClick={() =>
                                  setShowRegisterPassword(
                                    (current) =>
                                      !current,
                                  )
                                }
                                disabled={
                                  registerLoading
                                }
                              >
                                {
                                  showRegisterPassword
                                    ? (
                                        <EyeOff
                                          size={16}
                                          strokeWidth={1.8}
                                        />
                                      )
                                    : (
                                        <Eye
                                          size={16}
                                          strokeWidth={1.8}
                                        />
                                      )
                                }
                              </button>
                            </div>
                          </label>


                          <label className="auth-field">
                            <span>
                              Ulangi Password
                            </span>

                            <div className="auth-input">
                              <LockKeyhole
                                size={17}
                                strokeWidth={1.8}
                                aria-hidden="true"
                              />

                              <input
                                type={
                                  showConfirmPassword
                                    ? 'text'
                                    : 'password'
                                }
                                autoComplete="new-password"
                                minLength={12}
                                maxLength={128}
                                placeholder="Masukkan ulang password"
                                value={
                                  registerForm.confirmPassword
                                }
                                onChange={(event) =>
                                  setRegisterForm(
                                    (current) => ({
                                      ...current,

                                      confirmPassword:
                                        event.target.value,
                                    }),
                                  )
                                }
                                disabled={
                                  registerLoading
                                }
                                required
                              />

                              <button
                                className="auth-password-toggle"
                                type="button"
                                aria-label={
                                  showConfirmPassword
                                    ? 'Sembunyikan password'
                                    : 'Tampilkan password'
                                }
                                onClick={() =>
                                  setShowConfirmPassword(
                                    (current) =>
                                      !current,
                                  )
                                }
                                disabled={
                                  registerLoading
                                }
                              >
                                {
                                  showConfirmPassword
                                    ? (
                                        <EyeOff
                                          size={16}
                                          strokeWidth={1.8}
                                        />
                                      )
                                    : (
                                        <Eye
                                          size={16}
                                          strokeWidth={1.8}
                                        />
                                      )
                                }
                              </button>
                            </div>
                          </label>


                          <div className="auth-register-note">
                            <ShieldCheck
                              size={16}
                              strokeWidth={1.9}
                              aria-hidden="true"
                            />

                            <span>
                              Akun operator baru
                              membutuhkan aktivasi
                              administrator sebelum
                              dapat login.
                            </span>
                          </div>


                          {
                            registerNotice
                            && (
                              <p
                                className="auth-notice auth-notice--error"
                                role="alert"
                              >
                                {
                                  registerNotice
                                }
                              </p>
                            )
                          }


                          <button
                            className="auth-submit"
                            type="submit"
                            disabled={
                              registerLoading
                            }
                          >
                            <span>
                              {
                                registerLoading
                                  ? 'Mendaftarkan...'
                                  : 'Daftar Operator'
                              }
                            </span>

                            {
                              !registerLoading
                              && (
                                <ArrowRight
                                  size={17}
                                  strokeWidth={2}
                                  aria-hidden="true"
                                />
                              )
                            }
                          </button>
                        </form>
                      </>
                    )
              }


              
            </div>


            <footer className="auth-footer">
              © {new Date().getFullYear()}
              {' '}
              SPFF · Smart Fertigasi
            </footer>
          </section>


          <AuthVisual />
        </div>
      </main>
    )
  }


  return (
    <AuthContext.Provider
      value={context}
    >
      {children}
    </AuthContext.Provider>
  )
}
