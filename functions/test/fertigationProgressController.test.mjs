import test from 'node:test'
import assert from 'node:assert/strict'
process.env.DATABASE_URL='postgres://test:test@localhost/test'
const repo=await import('../lib/services/postgresRepository.js')
const {getFertigationProgress}=await import('../lib/controllers/fertigationProgressController.js')
test('progress diagnostics distinguish invalid input, missing schema, permissions and invalid stored rules',async()=>{
 const previousQuery=repo.pool.query,previousError=console.error
 const finish=repo.pool.end.bind(repo.pool)
 let calls=0
 const response=()=>({statusCode:200,body:null,status(code){this.statusCode=code;return this},set(){return this},json(body){this.body=body;return this}})
 try{
  console.error=()=>{}
  repo.pool.query=async()=>{calls++;throw Object.assign(new Error('internal SQL details'),{code:'42P01'})}
  const invalid=response();await getFertigationProgress({query:{deviceId:'not allowed!'}},invalid,()=>assert.fail('invalid input must be handled'))
  assert.equal(invalid.statusCode,400);assert.equal(calls,0)
  for(const [code,status,expected]of [['42P01',503,/migration/],['42703',503,/migration/],['42501',503,/Izin database/]]){
   repo.pool.query=async()=>{throw Object.assign(new Error('internal SQL details'),{code})}
   const res=response();await getFertigationProgress({query:{deviceId:'esp32-s3-01'}},res,()=>assert.fail('known dependency failure must be handled'))
   assert.equal(res.statusCode,status);assert.match(res.body.message,expected);assert.doesNotMatch(res.body.message,/internal SQL/)
  }
  const {z}=await import('zod');let storedError
  try{z.number().parse('bad rule')}catch(e){storedError=e}
  repo.pool.query=async()=>{throw storedError}
  const res=response();await getFertigationProgress({query:{deviceId:'esp32-s3-01'}},res,()=>assert.fail('stored-rule error must be handled'))
  assert.equal(res.statusCode,409);assert.match(res.body.message,/Data aturan tanaman/)
 }finally{repo.pool.query=previousQuery;console.error=previousError;await finish()}
})
