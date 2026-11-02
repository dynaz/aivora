import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger.mjs';
test('charge reduces balance and retry does not charge twice',()=>{const l=new Ledger(10);assert.deepEqual(l.charge('a',3),{balance:7,charged:true});assert.deepEqual(l.charge('a',3),{balance:7,charged:false});});
test('insufficient credits leave balance intact',()=>{const l=new Ledger(2);assert.throws(()=>l.charge('a',3),/Insufficient/);assert.equal(l.balance,2);});
test('reject invalid and conflicting charges',()=>{const l=new Ledger(10);for(const n of [0,-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>l.charge('a',n));assert.throws(()=>l.charge('',1));l.charge('a',2);assert.throws(()=>l.charge('a',3),/conflict/);assert.equal(l.balance,8);});
test('zero balance cannot overspend',()=>{const l=new Ledger(1);l.charge('a',1);assert.throws(()=>l.charge('b',1));assert.equal(l.balance,0);});
