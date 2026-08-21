import {
  createContext,
  useContext,
} from 'react'

import type {
  AuthUser,
} from './api'


export type AuthContextValue = {
  user: AuthUser

  logout: () => Promise<void>
}


export const AuthContext =
  createContext<
    AuthContextValue | null
  >(null)


export function useAuth():
AuthContextValue {
  const context =
    useContext(AuthContext)


  if (!context) {
    throw new Error(
      'useAuth harus digunakan di dalam AuthGate.',
    )
  }


  return context
}