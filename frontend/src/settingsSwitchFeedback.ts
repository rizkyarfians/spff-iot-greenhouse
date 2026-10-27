export type SwitchNotice = {kind:'error'|'warning'|'success'|'info';message:string}

export function switchSaveError(error:unknown) {
  if(error instanceof Error&&['TimeoutError','AbortError','TypeError'].includes(error.name))
    return 'Koneksi terputus atau waktu tunggu habis. Perubahan belum dapat dipastikan. Muat ulang status sebelum mencoba lagi.'
  return error instanceof Error?error.message:'Gagal menyimpan perubahan switch. Silakan coba lagi.'
}
