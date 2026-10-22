// Server-only administrator APIs. Never trust the dashboard to enforce permissions.
export function installAdmin(app,store,broker,sessions) {
  const json=(res,status,error)=>res.status(status).json({error});
  const requireAdmin=(req,res,next)=>sessions.requireSession(req,res,()=>{
    const account=store.accountById(req.session.owner);
    if(!account?.admin)return json(res,403,'仅管理员可操作');
    next();
  });
  app.get('/api/manage/admin',requireAdmin,(_req,res)=>{
    const users=store.db.prepare(`
      SELECT a.id,a.username,a.admin,a.created,g.email,
        (SELECT COUNT(*) FROM registry r WHERE r.owner=a.id AND r.revoked=0) AS deviceCount,
        COALESCE(l.max_devices,50) AS deviceLimit
      FROM accounts a
      LEFT JOIN google_identities g ON g.owner=a.id
      LEFT JOIN account_device_limits l ON l.owner=a.id
      ORDER BY a.admin DESC,a.created DESC,a.id
    `).all();
    res.json({registrationEnabled:store.registrationEnabled(),users});
  });
  app.post('/api/manage/admin/registration',requireAdmin,(req,res)=>{
    if(typeof req.body?.enabled!=='boolean')return json(res,400,'enabled 必须是布尔值');
    store.transaction(()=>store.setRegistrationEnabled(req.body.enabled));
    res.json({registrationEnabled:store.registrationEnabled()});
  });
  app.post('/api/manage/admin/users/:id/device-limit',requireAdmin,(req,res)=>{
    const targetId=req.params.id,limit=req.body?.limit;
    if(typeof targetId!=='string'||!targetId||targetId.length>128)return json(res,400,'无效用户');
    if(!Number.isSafeInteger(limit)||limit<0||limit>1000)return json(res,400,'设备上限必须为 0–1000 的整数');
    const result=store.transaction(()=>{
      if(!store.accountById(targetId))return null;
      store.setDeviceLimit(targetId,limit);
      return {deviceLimit:store.deviceLimit(targetId)};
    });
    if(!result)return json(res,404,'账户不存在');
    res.json(result);
  });
  app.post('/api/manage/admin/users/:id/delete',requireAdmin,(req,res)=>{
    const targetId=req.params.id;
    if(typeof targetId!=='string'||targetId.length>128)return json(res,400,'无效用户');
    if(targetId===req.session.owner)return json(res,403,'不能删除自己的账户');
    const outcome=store.transaction(()=>{
      const account=store.accountById(targetId);
      if(!account)return {status:404,error:'账户不存在'};
      if(account.admin||account.id==='owner')return {status:403,error:'不能删除管理员账户'};
      const devices=store.db.prepare('SELECT id FROM registry WHERE owner=?').all(targetId).map(d=>d.id);
      // Revoke first. Keeping minimal tombstones lets installed agents detect revocation.
      store.db.prepare("UPDATE registry SET revoked=1,tokenHash=NULL,pendingHash=NULL,owner='deleted',name='已注销设备',platform=NULL,version=NULL,revokedAt=? WHERE owner=?").run(Date.now(),targetId);
      store.db.prepare('DELETE FROM devices WHERE owner=?').run(targetId);
      store.db.prepare('DELETE FROM pairings WHERE owner=?').run(targetId);
      store.db.prepare('DELETE FROM sessions WHERE owner=?').run(targetId);
      store.db.prepare("DELETE FROM grants WHERE json_valid(value)=1 AND json_extract(value,'$.ownerId')=?").run(targetId);
      store.db.prepare('DELETE FROM google_identities WHERE owner=?').run(targetId);
      store.db.prepare('DELETE FROM calls WHERE owner=?').run(targetId);
      store.db.prepare('DELETE FROM monthly_usage WHERE owner=?').run(targetId);
      store.db.prepare('DELETE FROM account_device_limits WHERE owner=?').run(targetId);
      store.db.prepare('DELETE FROM accounts WHERE id=?').run(targetId);
      return {devices};
    });
    if(outcome.status)return json(res,outcome.status,outcome.error);
    for(const id of outcome.devices)broker.revoke(id);
    res.json({ok:true});
  });
}
