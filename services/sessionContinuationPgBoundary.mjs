// P0-504: genuine PostgreSQL transaction boundary for the continuation coordinator.
// A service adapter still must implement row-locking, auth, pricing, finance,
// outbox and idempotency. This module does NOT expose or activate a route.
export function createSessionContinuationPgBoundary({pool,buildAdapter}){
  if(!pool||typeof pool.connect!=='function'||typeof buildAdapter!=='function')
    throw new TypeError('PostgreSQL pool and transaction adapter factory required');
  return Object.freeze({
    async withTransaction(operation){
      if(typeof operation!=='function')throw new TypeError('Transaction callback required');
      const client=await pool.connect();
      if(typeof client?.query!=='function'||typeof client?.release!=='function'){
        client?.release?.();
        throw new Error('INVALID_POSTGRES_CONNECTION');
      }
      let started=false;
      let discard=false;
      try{
        // Shared client + transaction ensure all calendar/finance writes either
        // commit together or roll back together, including trigger effects.
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
        started=true;
        await client.query('SET LOCAL statement_timeout = 15000');
        await client.query('SET LOCAL lock_timeout = 5000');
        const adapter=await buildAdapter(client);
        if(!adapter||typeof adapter!=='object')throw new Error('TRANSACTION_ADAPTER_REQUIRED');
        const response=await operation(adapter);
        await client.query('COMMIT');
        return response;
      }catch(error){
        if(started){
          try{await client.query('ROLLBACK');}
          catch(rollbackError){
            // Do not mask the original failure; the connection is discarded.
            discard=true;
            throw new AggregateError([error,rollbackError],'SESSION_TRANSACTION_ROLLBACK_FAILED');
          }
        }
        throw error;
      }finally{
        // Rollback failure makes the connection unsuitable for reuse.
        client.release(discard);
      }
    }
  });
}
