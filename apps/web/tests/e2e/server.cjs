const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../public');
const allowed=new Set(['/nations-live.html','/nba-momentum-monitor.html']);
http.createServer((req,res)=>{
 const url=new URL(req.url||'/', 'http://127.0.0.1:4179');
 if(!allowed.has(url.pathname)){res.writeHead(404);res.end('Not Found');return}
 const file=path.join(root,url.pathname.slice(1));
 fs.readFile(file,(error,body)=>{
  if(error){res.writeHead(500,{'content-type':'text/plain'});res.end('Missing test fixture: '+url.pathname);return}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(body)
 })
}).listen(4179,'127.0.0.1');
