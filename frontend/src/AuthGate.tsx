import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

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
        <section className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand-mark">
              SPFF
            </span>


            <div>
              <h1>
                Smart Greenhouse
              </h1>

              <p>
                Memeriksa session lokal...
              </p>
            </div>
          </div>


          <div
            className="auth-loading"
            role="status"
          >
            Menghubungkan ke server lokal.
          </div>
        </section>
      </main>
    )
  }


  if (
    !user
    || !context
  ) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand-mark">
              SPFF
            </span>


            <div>
              <h1>
                Smart Greenhouse
              </h1>

              <p>
                {
                  authMode === 'login'
                    ? 'Login dashboard lokal.'
                    : 'Daftar akun operator.'
                }
              </p>
            </div>
          </div>


          {
            authMode === 'login'
              ? (
                  <form
                    className="auth-form"
                    onSubmit={
                      submitLogin
                    }
                  >
                    <label>
                      <span>
                        Username
                      </span>

                      <input
                        type="text"
                        autoComplete="username"
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
                    </label>


                    <label>
                      <span>
                        Password
                      </span>

                      <input
                        type="password"
                        autoComplete="current-password"
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
                      {
                        loginLoading
                          ? 'Masuk...'
                          : 'Masuk'
                      }
                    </button>


                    <button
                      className="user-action-button"
                      type="button"
                      onClick={
                        showRegister
                      }
                    >
                      Belum punya akun?
                      {' '}
                      Daftar
                    </button>
                  </form>
                )

              : (
                  <form
                    className="auth-form"
                    onSubmit={
                      submitRegister
                    }
                  >
                    <label>
                      <span>
                        Nama
                      </span>

                      <input
                        type="text"
                        autoComplete="name"
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
                    </label>


                    <label>
                      <span>
                        Username
                      </span>

                      <input
                        type="text"
                        autoComplete="username"
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
                    </label>


                    <label>
                      <span>
                        Password
                      </span>

                      <input
                        type="password"
                        autoComplete="new-password"
                        minLength={12}
                        maxLength={128}
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
                    </label>


                    <label>
                      <span>
                        Ulangi Password
                      </span>

                      <input
                        type="password"
                        autoComplete="new-password"
                        minLength={12}
                        maxLength={128}
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
                    </label>


                    <p className="auth-local-note">
                      Akun baru otomatis menjadi
                      operator dan harus diaktifkan
                      administrator sebelum dapat login.
                    </p>


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
                      {
                        registerLoading
                          ? 'Mendaftarkan...'
                          : 'Daftar'
                      }
                    </button>


                    <button
                      className="user-action-button"
                      type="button"
                      onClick={
                        showLogin
                      }
                    >
                      Sudah punya akun?
                      {' '}
                      Kembali ke Login
                    </button>
                  </form>
                )
          }


          <p className="auth-local-note">
            Authentication menggunakan
            server dan PostgreSQL lokal.
          </p>
        </section>
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