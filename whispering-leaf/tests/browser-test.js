const {chromium}=require('playwright');const SP=process.argv[2];const url='file://'+process.cwd()+'/index.html';
(async()=>{const b=await chromium.launch();const r=[];const ok=(n,c)=>r.push((c?'PASS ':'FAIL ')+n);
for(const [name,vp] of [['desktop',{width:1366,height:850}],['mobile',{width:390,height:844}]]){
 const p=await b.newPage({viewport:vp});const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
 await p.goto(url);await p.waitForTimeout(1500);
 ok(name+' video element present & playing',await p.evaluate(()=>{const v=document.getElementById('heroVideo');return !!v&&v.readyState>=2}));
 ok(name+' no horizontal scroll',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 ok(name+' 6 service cards',await p.locator('.services .card').count()===6);
 if(name==='mobile'){await p.click('.menu-btn');await p.waitForTimeout(400);ok('mobile menu opens',await p.locator('#menu.open').count()===1);
   await p.click('#menu a[href="#portal"]');await p.waitForTimeout(1600);ok('mobile nav closes + scrolls',await p.evaluate(()=>!document.getElementById('menu').classList.contains('open')&&scrollY>500));}
 else{await p.click('#menu a[href="#process"]');await p.waitForTimeout(1600);ok('nav link scrolls',await p.evaluate(()=>Math.abs(document.getElementById('process').getBoundingClientRect().top)<120));}
 await p.goto(url);await p.click('.hero-actions .btn-primary');await p.waitForTimeout(1600);ok(name+' hero CTA scrolls to form',await p.evaluate(()=>Math.abs(document.getElementById('quote').getBoundingClientRect().top)<120));
 await p.click('#quoteForm button[type=submit]');ok(name+' empty submit shows 6 errors',await p.locator('.field.invalid').count()===6);
 await p.fill('#name','Test Person');await p.fill('#email','bad');await p.click('#quoteForm button[type=submit]');ok(name+' bad email flagged',await p.locator('.field.invalid #email').count()===1);
 await p.fill('#email','t@example.com');await p.fill('#suburb','Manly');await p.selectOption('#service','Paving');await p.selectOption('#budget',{index:2});await p.fill('#desc','Short');
 await p.click('#quoteForm button[type=submit]');ok(name+' short description flagged',await p.locator('.field.invalid #desc').count()===1);
 await p.fill('#desc','Sloping backyard, want a flat sandstone terrace and low-water planting.');await p.click('#quoteForm button[type=submit]');
 ok(name+' success state shown',await p.locator('#success.show').isVisible());
 await p.screenshot({path:`${SP}/${name}-success.png`});
 await p.click('#resetForm');ok(name+' reset works',await p.locator('#name').inputValue()==='');
 await p.evaluate(()=>scrollTo(0,document.getElementById('services').offsetTop));await p.waitForTimeout(500);
 await p.locator('.more').nth(2).click();ok(name+' service modal opens',await p.locator('#serviceModal[open]').count()===1);
 await p.click('#modalCta');await p.waitForTimeout(800);ok(name+' modal CTA prefills service',await p.inputValue('#service')==='Retaining walls');
 await p.evaluate(()=>{const i=document.querySelector('#ba input');i.value=20;i.dispatchEvent(new Event('input'))});
 ok(name+' before/after slider',await p.evaluate(()=>document.getElementById('ba').style.getPropertyValue('--pos')==='20%'));
 await p.goto(url);await p.waitForTimeout(800);await p.screenshot({path:`${SP}/${name}-hero.png`});
 await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=400){scrollTo(0,y);await new Promise(r=>setTimeout(r,60))}});await p.waitForTimeout(800);
 await p.screenshot({path:`${SP}/${name}-full.png`,fullPage:true});
 ok(name+' no JS/console errors '+JSON.stringify(errs),errs.length===0);await p.close();}
console.log(r.join('\n'));await b.close();})();
