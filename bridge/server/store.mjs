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
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_device_limits(owner TEXT PRIMARY KEY,max_devices INTEGER NOT NULL CHECK(max_devices BETWEEN 0 AND 1000));
    CREATE TABLE IF NOT EXISTS device_tool_policies(owner TEXT NOT NULL,device TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('full','read_only','custom')),allowed TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(owner,device));
  `);
  // Keep revoked registration records for owner-visible audit and re-pair guidance.
  if(!db.prepare('PRAGMA table_info(registry)').all().some(r=>r.name==='revokedAt'))db.exec('ALTER TABLE registry ADD COLUMN revokedAt INTEGER');
  const columns=db.prepare('PRAGMA table_info(calls)').all().map(r=>r.name);
  for(const [name,type] of [['owner',"TEXT NOT NULL DEFAULT 'owner'"],['result','TEXT'],['error','TEXT']]) if(!columns.includes(name)) db.exec(`ALTER TABLE calls ADD COLUMN ${name} ${type}`);
  if(!db.prepare('PRAGMA table_info(devices)').all().some(r=>r.name==='owner'))db.exec('ALTER TABLE devices ADD COLUMN owner TEXT');
  // Legacy catalogs without an account binding stay hidden until a fresh authenticated hello.
  // A relay restart does not establish whether an in-flight side effect completed.
  db.exec("UPDATE calls SET status='unknown',finished=unixepoch()*1000 WHERE status='executing'");
  // One-time migration for existing databases: retain only the newest 100 rows per account.
  db.exec(`DELETE FROM calls WHERE rowid IN (
    SELECT rowid FROM (
      SELECT rowid, ROW_NUMBER() OVER (PARTITION BY owner ORDER BY started DESC, rowid DESC) AS position
      FROM calls
    ) WHERE position > 100
  )`);
  const parse=r=>r&&JSON.parse(r.value);
  const device=id=>db.prepare('SELECT * FROM registry WHERE id=? AND revoked=0').get(id);
  const trimCalls=owner=>db.prepare('DELETE FROM calls WHERE owner=? AND rowid NOT IN (SELECT rowid FROM calls WHERE owner=? ORDER BY started DESC, rowid DESC LIMIT 100)').run(owner,owner);
  return {
    db,
    migrate(config) {
      db.prepare('INSERT OR IGNORE INTO accounts VALUES (?,?,?,?,?)').run('owner',config.ownerUsername??'owner',config.ownerPasswordHash,1,Date.now());
      for(const d of config.devices??[]) db.prepare('INSERT OR IGNORE INTO registry(id,owner,name,tokenHash) VALUES (?,?,?,?)').run(d.id,'owner',d.name,d.tokenHash);
      // Only pre-existing single-owner grants lack ownerId. New grants always carry it.
      db.prepare("UPDATE grants SET value=json_set(value,'$.ownerId','owner') WHERE kind IN ('access','refresh','code') AND json_extract(value,'$.ownerId') IS NULL").run();
    },
    registrationEnabled() {return db.prepare("SELECT value FROM settings WHERE key='registration_enabled'").get()?.value!=='0';},
    setRegistrationEnabled(enabled) {db.prepare("INSERT INTO settings(key,value) VALUES ('registration_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(enabled?'1':'0');},
    // Existing accounts without an override keep the historical 50-device limit.
    deviceLimit(owner) {return db.prepare('SELECT max_devices FROM account_device_limits WHERE owner=?').get(owner)?.max_devices??50;},
    setDeviceLimit(owner,limit) {db.prepare('INSERT INTO account_device_limits(owner,max_devices) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET max_devices=excluded.max_devices').run(owner,limit);},
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
    devicePolicy(owner,id) {
      if(!db.prepare('SELECT id FROM registry WHERE id=? AND owner=? AND revoked=0').get(id,owner))throw new Error('Device not found');
      const row=db.prepare('SELECT mode,allowed,updated FROM device_tool_policies WHERE owner=? AND device=?').get(owner,id);
      return row?{device_id:id,mode:row.mode,allowed_tools:JSON.parse(row.allowed),updated:row.updated}:{device_id:id,mode:'full',allowed_tools:[],updated:null};
    },
    saveDevicePolicy(owner,id,mode,allowed=[]) {
      if(!['full','read_only','custom'].includes(mode))throw new Error('Invalid permission mode');
      if(!Array.isArray(allowed)||allowed.length>128||allowed.some(n=>typeof n!=='string'||n.length>128)||new Set(allowed).size!==allowed.length)throw new Error('Invalid allowed tools');
      if(!db.prepare('SELECT id FROM registry WHERE id=? AND owner=? AND revoked=0').get(id,owner))throw new Error('Device not found');
      const known=JSON.parse(db.prepare('SELECT tools FROM devices WHERE id=? AND owner=?').get(id,owner)?.tools??'[]').map(t=>t.name);
      if(mode==='custom'&&allowed.some(name=>name!=='shutdown'&&!known.includes(name)))throw new Error('Unknown device tool');
      const normalized=mode==='custom'?allowed:[];
      db.prepare("INSERT INTO device_tool_policies(owner,device,mode,allowed,updated) VALUES (?,?,?,?,?) ON CONFLICT(owner,device) DO UPDATE SET mode=excluded.mode,allowed=excluded.allowed,updated=excluded.updated").run(owner,id,mode,JSON.stringify(normalized),Date.now());
      return this.devicePolicy(owner,id);
    },
    getClient(id) {return parse(db.prepare('SELECT value FROM clients WHERE id=?').get(id));},
    putClient(client) {db.prepare('INSERT INTO clients VALUES (?,?,?)').run(client.client_id,JSON.stringify(client),Date.now());},
    clientCount() {return db.prepare('SELECT count(*) AS n FROM clients').get().n;},
    grant(hash,kind) {return parse(db.prepare('SELECT value FROM grants WHERE hash=? AND kind=? AND expires>?').get(hash,kind,Date.now()));},
    saveGrant(hash,kind,client,value,expires) {db.prepare('INSERT INTO grants VALUES (?,?,?,?,?)').run(hash,kind,client,JSON.stringify(value),expires);},
    deleteGrant(hash) {db.prepare('DELETE FROM grants WHERE hash=?').run(hash);},
    transaction(fn) {db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},
    tools(id,owner='owner') {const r=db.prepare('SELECT tools FROM devices WHERE id=? AND owner=?').get(id,owner);return r?JSON.parse(r.tools):[];},
    saveTools(id,tools,owner='owner') {db.prepare('INSERT INTO devices(id,tools,updated,owner) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET tools=excluded.tools,updated=excluded.updated,owner=excluded.owner').run(id,JSON.stringify(tools),Date.now(),owner);},
    beginCall(id,device,tool,owner='owner') {
      // Bound stored results as well as the dashboard view, without touching other accounts.
      db.prepare('INSERT INTO calls(id,device,tool,status,started,owner) VALUES (?,?,?,?,?,?)').run(id,device,tool,'executing',Date.now(),owner);
      trimCalls(owner);
    },
    finishCall(id,status,result=null,error=null) {
      // A deadline, disconnect or repeated delivery must never replace a saved outcome.
      return db.prepare("UPDATE calls SET status=?,finished=?,result=?,error=? WHERE id=? AND status NOT IN ('completed','failed')").run(status,Date.now(),result===null?null:JSON.stringify(result),error,id).changes>0;
    },
    call(id,owner) {const r=db.prepare('SELECT * FROM calls WHERE id=? AND owner=?').get(id,owner);return r&&{...r,result:r.result?JSON.parse(r.result):null};},
    recentCalls(owner) {return db.prepare('SELECT id,device,tool,status,started,finished,error FROM calls WHERE owner=? ORDER BY started DESC, rowid DESC LIMIT 100').all(owner);},
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
