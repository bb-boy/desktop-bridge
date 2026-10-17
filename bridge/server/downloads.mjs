const names=new Set(['desktop-bridge-plugin.zip','DesktopBridge-macOS.pkg','DesktopBridge-Windows.cmd','DesktopBridge-Linux.sh','downloads.json','SHA256SUMS']);
export function installerDownload(req,res,next){
 const name=req.path.slice(1);
 if(names.has(name))res.attachment(name).set('Cache-Control','no-store');
 next();
}
