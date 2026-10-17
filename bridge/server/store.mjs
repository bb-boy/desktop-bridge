import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openStore(directory) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const filename=path.join(directory,'bridge.db');
  const db=new DatabaseSync(filename); fs.chmodSync(filename,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,value TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS grants(hash TEXT PRIMARY KEY,kind TEXT NOT NULL,client TEXT NOT NULL,value TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS grants_expiry ON grants(expires);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,tools TEXT NOT NULL,updated INTEGER NOT NULL,owner TEXT);
    CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,device TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,started INTEGER NOT NULL,finished INTEGER);
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS registry(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,tokenHash TEXT,pendingHash TEXT,paused INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0,version TEXT,platform TEXT,lastSeen INTEGER);
    CREATE INDEX IF NOT EXISTS registry_owner ON registry(owner);
    CREATE TABLE IF NOT EXISTS pairings(hash TEXT PRIMARY KEY,userHash TEXT UNIQUE NOT NULL,device TEXT NOT NULL,name TEXT NOT NULL,platform TEXT NOT NULL,version TEXT NOT NULL,owner TEXT,status TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,owner TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS monthly_usage(owner TEXT NOT NULL,month TEXT NOT NULL,calls INTEGER NOT NULL,started INTEGER NOT NULL,PRIMARY KEY(owner,month));
    CREATE TABLE IF NOT EXISTS invitations(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
  `);
  // Keep revoked registration records for owner-visible audit and re-pair guidance.
  if(!db.prepare('PRAGMA table_info(registry)').all().some(r=>r.name==='revokedAt'))db.exec('ALTER TABLE registry ADD COLUMN revokedAt INTEGER');
  const columns=db.prepare('PRAGMA table_info(calls)').all().map(r=>r.name);
  for(const [name,type] of [['owner',"TEXT NOT NULL DEFAULT 'owner'"],['result','TEXT'],['error','TEXT']]) if(!columns.includes(name)) db.exec(`ALTER TABLE calls ADD COLUMN ${name} ${type}`);
  if(!db.prepare('PRAGMA table_info(devices)').all().some(r=>r.name==='owner'))db.exec('ALTER TABLE devices ADD COLUMN owner TEXT');
  // Legacy catalogs without an account binding stay hidden until a fresh authenticated hello.
  // A relay restart does not establish whether an in-flight side effect completed.
  db.exec("UPDATE calls SET status='unknown',finished=unixepoch()*1000 WHERE status='executing'");
  const parse=r=>r&&JSON.parse(r.value);
  const device=id=>db.prepare('SELECT * FROM registry WHERE id=? AND revoked=0').get(id);
  return {
    db,
    migrate(config) {
      db.prepare('INSERT OR IGNORE INTO accounts VALUES (?,?,?,?,?)').run('owner',config.ownerUsername??'owner',config.ownerPasswordHash,1,Date.now());
      for(const d of config.devices??[]) db.prepare('INSERT OR IGNORE INTO registry(id,owner,name,tokenHash) VALUES (?,?,?,?)').run(d.id,'owner',d.name,d.tokenHash);
      // Only pre-existing single-owner grants lack ownerId. New grants always carry it.
      db.prepare("UPDATE grants SET value=json_set(value,'$.ownerId','owner') WHERE kind IN ('access','refresh','code') AND json_extract(value,'$.ownerId') IS NULL").run();
    },
    account(username) {return db.prepare('SELECT * FROM accounts WHERE username=?').get(username);},
    accountById(id) {return db.prepare('SELECT id,username,admin FROM accounts WHERE id=?').get(id);},
    recordToolCall(owner,now=Date.now()) {
      const month=new Date(now).toISOString().slice(0,7);
      db.prepare('INSERT INTO monthly_usage(owner,month,calls,started) VALUES (?,?,1,?) ON CONFLICT(owner,month) DO UPDATE SET calls=calls+1').run(owner,month,now);
    },
    monthlyUsage(owner,now=Date.now()) {
      const month=new Date(now).toISOString().slice(0,7);
      const row=db.prepare('SELECT calls,started FROM monthly_usage WHERE owner=? AND month=?').get(owner,month);
      return {month,toolCalls:row?.calls??0,countedSince:row?new Date(row.started).toISOString():null};
    },
    device, devices(owner) {return owner===undefined?db.prepare('SELECT * FROM registry WHERE revoked=0').all():db.prepare('SELECT * FROM registry WHERE owner=? AND revoked=0').all(owner);},
    getClient(id) {return parse(db.prepare('SELECT value FROM clients WHERE id=?').get(id));},
    putClient(client) {db.prepare('INSERT INTO clients VALUES (?,?,?)').run(client.client_id,JSON.stringify(client),Date.now());},
    clientCount() {return db.prepare('SELECT count(*) AS n FROM clients').get().n;},
    grant(hash,kind) {return parse(db.prepare('SELECT value FROM grants WHERE hash=? AND kind=? AND expires>?').get(hash,kind,Date.now()));},
    saveGrant(hash,kind,client,value,expires) {db.prepare('INSERT INTO grants VALUES (?,?,?,?,?)').run(hash,kind,client,JSON.stringify(value),expires);},
    deleteGrant(hash) {db.prepare('DELETE FROM grants WHERE hash=?').run(hash);},
    transaction(fn) {db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},
    tools(id,owner='owner') {const r=db.prepare('SELECT tools FROM devices WHERE id=? AND owner=?').get(id,owner);return r?JSON.parse(r.tools):[];},
    saveTools(id,tools,owner='owner') {db.prepare('INSERT INTO devices(id,tools,updated,owner) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET tools=excluded.tools,updated=excluded.updated,owner=excluded.owner').run(id,JSON.stringify(tools),Date.now(),owner);},
    beginCall(id,device,tool,owner='owner') {db.prepare('INSERT INTO calls(id,device,tool,status,started,owner) VALUES (?,?,?,?,?,?)').run(id,device,tool,'executing',Date.now(),owner);},
    finishCall(id,status,result=null,error=null) {
      // A deadline, disconnect or repeated delivery must never replace a saved outcome.
      return db.prepare("UPDATE calls SET status=?,finished=?,result=?,error=? WHERE id=? AND status NOT IN ('completed','failed')").run(status,Date.now(),result===null?null:JSON.stringify(result),error,id).changes>0;
    },
    call(id,owner) {const r=db.prepare('SELECT * FROM calls WHERE id=? AND owner=?').get(id,owner);return r&&{...r,result:r.result?JSON.parse(r.result):null};},
    recentCalls(owner) {return db.prepare('SELECT id,device,tool,status,started,finished,error FROM calls WHERE owner=? ORDER BY started DESC LIMIT 100').all(owner);},
    cleanup() {
      const now=Date.now();
      db.prepare('DELETE FROM grants WHERE expires<?').run(now);
      for(const table of ['sessions','pairings','invitations']) db.prepare(`DELETE FROM ${table} WHERE expires<?`).run(now);
      db.prepare('DELETE FROM calls WHERE started<?').run(now-30*86400000);
      db.prepare("DELETE FROM clients WHERE created<? AND id NOT IN (SELECT client FROM grants)").run(now-180*86400000);
    },
    close(){db.close();}
  };
}
