const API=process.env.API_URL||'http://localhost:8080';
async function req(path,body){const r=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());return r.json()}
const p=await req('/api/projects',{name:'Launch Operations',description:'Demo project for the HappyRobot walkthrough'});
const research=await req(`/api/projects/${p.id}/tasks`,{title:'Research customer workflow',configuration:{priority:'high',description:'Map current workflow and failure modes',tags:['discovery'],customFields:{ownerTeam:'Product'}}});
const build=await req(`/api/projects/${p.id}/tasks`,{title:'Build automation',dependencies:[research.id],configuration:{priority:'urgent',description:'Implement the automated workflow',tags:['engineering'],customFields:{}}});
await req(`/api/tasks/${research.id}/comments`,{author:'Demo User',content:'Open this project in a second tab to watch comments arrive live.'});
console.log(JSON.stringify({project:p,research,build},null,2));
