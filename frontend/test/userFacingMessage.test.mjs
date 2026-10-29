import test from 'node:test'
import assert from 'node:assert/strict'
import {userFacingMessage} from '../src/userFacingMessage.ts'
test('installation and database errors do not expose internals to growers',()=>{
 for(const text of ['Periksa migration 035/036 dan izin database.','relation "spff.sessions" does not exist','ECONNREFUSED 127.0.0.1:5432'])assert.equal(userFacingMessage(text),'Fitur belum siap. Hubungi pengelola.')
})
test('technical pump messages retain the need to check equipment',()=>{
 assert.match(userFacingMessage('Periksa ACK firmware dan dispatcher.'),/pastikan pompa/)
})
test('actionable warnings and input validation remain unchanged',()=>{
 for(const text of ['Tandon air di bawah batas minimum.','Pompa belum terkonfirmasi berhenti.','Target EC harus lebih besar dari batas mulai.','Data berubah. Muat ulang sebelum menyimpan.'])assert.equal(userFacingMessage(text),text)
})
