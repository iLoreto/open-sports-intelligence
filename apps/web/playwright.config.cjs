const { defineConfig } = require('@playwright/test');
module.exports=defineConfig({
 testDir:'./tests/e2e',webServer:{command:'node tests/e2e/server.cjs',url:'http://127.0.0.1:4179/nations-live.html',reuseExistingServer:false},timeout:30000,retries:0,
 use:{browserName:'chromium',headless:true},
 reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report'}]]
});
