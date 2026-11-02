import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/ledger.mjs';
test('restart retains balance and deduplication; changed payload is rejected',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aivora-'));const path=join(dir,'test.sqlite');
  let ledger=new Ledger(100,path);
  try {
    ledger.charge('request',7,'hello');ledger.close();ledger=new Ledger(100,path);
    assert.equal(ledger.balance,93);
    assert.equal(ledger.charge('request',7,'hello').charged,false);
    assert.throws(()=>ledger.charge('request',7,'changed'),/conflict/);
    assert.equal(ledger.history().length,1);
    assert.equal(ledger.balance,93);
  } finally {ledger.close();rmSync(dir,{recursive:true,force:true});}
});
test('two connections cannot overspend a shared balance',()=>{
 const dir=mkdtempSync(join(tmpdir(),'aivora-'));const path=join(dir,'test.sqlite');
 const a=new Ledger(1,path),b=new Ledger(100,path);
 try {a.charge('a',1);assert.throws(()=>b.charge('b',1),/Insufficient/);assert.equal(b.balance,0);assert.equal(b.history().length,1);}
 finally {a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
