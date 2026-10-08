import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { checkCloudConfig, cloudConfigFromEnvironment, validateCheckConfig } from "../src/check-client.mjs";
import { check } from "../src/check.mjs";
import { marker } from "../src/codemod.mjs";
import { installedApp, fixtureConfig, snapshot } from "./fixtures.mjs";

const ready = () => Response.json({ schemaVersion:1, status:"ready" });
test("sends only a bounded, nonredirecting authenticated GET without uploads", async () => {
  assert.deepEqual(await checkCloudConfig(fixtureConfig,{request:async (url,init) => {
    assert.equal(url,"https://kue.test/v1/project/check");
    assert.equal(init.method,"GET"); assert.equal(init.redirect,"error"); assert.equal(init.cache,"no-store");
    assert.equal(init.headers.Authorization,`Bearer ${fixtureConfig.projectKey}`); assert.equal(init.body,undefined);
    assert.ok(init.signal instanceof AbortSignal); return ready();
  }}),{status:"ready"});
});
test("refuses unsafe origins and missing keys before contacting any server", async () => {
  for(const apiBaseUrl of [undefined,"http://kue.test","https://user:secret@kue.test","https://kue.test/path","https://kue.test?key=secret","https://kue.test#secret"]) {
    assert.throws(()=>validateCheckConfig({...fixtureConfig,apiBaseUrl}),/same HTTPS/);
  }
  for(const projectKey of [undefined,"", "sk_live_secret", "pk_bad"]) assert.throws(()=>validateCheckConfig({...fixtureConfig,projectKey}),/same HTTPS/);
});
test("environment mode requires explicit intent and never substitutes another config", () => {
  assert.equal(cloudConfigFromEnvironment({EXPO_PUBLIC_KUE_ENABLED:"false"}),null);
  assert.equal(cloudConfigFromEnvironment({EXPO_PUBLIC_KUE_MODE:"local"}),null);
  assert.throws(()=>cloudConfigFromEnvironment({}),/explicitly/);
  assert.throws(()=>cloudConfigFromEnvironment({EXPO_PUBLIC_KUE_ENABLED:"FALSE"}),/same HTTPS/);
  assert.throws(()=>cloudConfigFromEnvironment({EXPO_PUBLIC_KUE_MODE:"cloud"}),/same HTTPS/);
  assert.deepEqual(cloudConfigFromEnvironment({EXPO_PUBLIC_KUE_MODE:"cloud",EXPO_PUBLIC_KUE_API_BASE_URL:fixtureConfig.apiBaseUrl,EXPO_PUBLIC_KUE_PROJECT_KEY:fixtureConfig.projectKey}),fixtureConfig);
});
for(const [status,code] of [[401,"unauthorized"],[403,"project_plan_paused"],[409,"storage_quota_exceeded"],[429,"quota_exceeded"],[503,"delivery_disabled"],[503,"configuration_error"],[409,"project_not_configured"],[429,"rate_limited"]]) {
  test(`fails closed with an actionable ${code} error without echoing provider content`,async()=>{
    await assert.rejects(checkCloudConfig(fixtureConfig,{request:async()=>Response.json({error:{code,message:fixtureConfig.projectKey}},{status})}),e=>{
      assert.equal(e.code,code); assert.ok(!e.message.includes(fixtureConfig.projectKey)); return true;
    });
  });
}
test("unknown, malformed, oversized and falsely positive responses never pass",async()=>{
  for(const response of [Response.json({status:"ready"}),Response.json({schemaVersion:2,status:"ready"}),new Response("ready"),
    Response.json({schemaVersion:1,status:"ready",padding:"a".repeat(5000)}), Response.json({schemaVersion:1,status:"ready"},{status:503}),
    Response.json({error:{code:fixtureConfig.projectKey,message:fixtureConfig.projectKey}},{status:500})]) {
    await assert.rejects(checkCloudConfig(fixtureConfig,{request:async()=>response}),e=>e.code==="unverified"&&!e.message.includes(fixtureConfig.projectKey));
  }
  for(const status of [404,405]) await assert.rejects(checkCloudConfig(fixtureConfig,{request:async()=>new Response(null,{status})}),{code:"unsupported_server"});
});
test("network errors and slow headers or body fail closed without leaking a URL/key",async()=>{
  await assert.rejects(checkCloudConfig(fixtureConfig,{request:async()=>{throw new Error(fixtureConfig.projectKey);}}),e=>e.code==="unverified"&&!e.message.includes(fixtureConfig.projectKey));
  await assert.rejects(checkCloudConfig(fixtureConfig,{request:()=>new Promise(()=>{}),timeoutMs:20}),{code:"unverified"});
  await assert.rejects(checkCloudConfig(fixtureConfig,{request:async()=>new Response(new ReadableStream({start(){}}),{headers:{"content-type":"application/json"}}),timeoutMs:20}),{code:"unverified"});
});
test("managed checks are read-only and do not execute config JavaScript",async()=>{
  const cwd=await installedApp(); await mkdir(`${cwd}/.kue`);
  await writeFile(`${cwd}/.kue/config.js`,`${marker}\nexport const kueCloudConfig = ${JSON.stringify(fixtureConfig)};\n`);
  const before=await snapshot(cwd); let calls=0;
  await check([],cwd,{request:async()=>{calls++;return ready();},log:()=>{}});
  assert.equal(calls,1); assert.deepEqual(await snapshot(cwd),before);
  await writeFile(`${cwd}/.kue/config.js`,`${marker}\nthrow Error('must not execute');`);
  await assert.rejects(check([],cwd),/Cannot read managed/);
});
test("explicit JSON/env sources, skip paths and option errors never leak configuration",async()=>{
  const cwd=await installedApp(); const output=[];
  await check(["--config","project.json"],cwd,{request:async()=>ready(),log:s=>output.push(s)});
  await check(["--env"],cwd,{env:{EXPO_PUBLIC_KUE_MODE:"local"},request:()=>assert.fail("must not request"),log:s=>output.push(s)});
  await assert.rejects(check(["--env","--config","project.json"],cwd),/only one/);
  await assert.rejects(check(["--project-key",fixtureConfig.projectKey],cwd),e=>!e.message.includes(fixtureConfig.projectKey));
  assert.ok(output.every(s=>!s.includes(fixtureConfig.projectKey)));
});
