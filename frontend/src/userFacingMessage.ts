/** Keep installation and transport internals out of messages shown to growers. */
export function userFacingMessage(message:string):string {
 if(/migration|migrasi|\bPostgreSQL\b|\bSQLSTATE\b|relation .+ does not exist|\bpg-pool\b|\bnode_modules\b|\bECONNREFUSED\b|\bSELECT\b.+\bFROM\b/i.test(message))return 'Fitur belum siap. Hubungi pengelola.'
 if(/\bACK\b|dispatcher|relay ownership|stop\/release/i.test(message))return 'Periksa koneksi alat dan pastikan pompa dalam kondisi aman sebelum mencoba kembali.'
 if(/^HTTP\s+\d+$/.test(message))return 'Permintaan belum berhasil. Coba muat ulang.'
 return message
}
