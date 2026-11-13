const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../public');
http.createServer((req,res)=>{if(req.url==='/nations-live.html'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});fs.createReadStream(path.join(root,'nations-live.html')).pipe(res);return}res.writeHead(404);res.end('Not Found')}).listen(4179,'127.0.0.1');
