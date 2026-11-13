const { defineConfig } = require('@playwright/test');
module.exports=defineConfig({
 testDir:'./tests/e2e',timeout:30000,retries:0,
 use:{browserName:'chromium',headless:true},
 reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report'}]]
});
