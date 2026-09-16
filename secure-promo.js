(function(){
  if(!window.UCAPI)return;
  gh=async()=>{throw new Error("Прямой доступ к GitHub отключён")};
  readRemote=async()=>{const d=await UCAPI.publicPromotions();return{sha:"",items:d.items||[]}};
  load=async()=>{const d=await UCAPI.publicPromotions();ITEMS=d.items||[];saveLocal(ITEMS);return{sha:"",items:ITEMS}};
  mutate=async function(fn){
    const before=(await UCAPI.publicPromotions()).items||[], next=fn(before.map(x=>({...x}))), old=new Map(before.map(x=>[String(x.id),x]));
    for(const item of next){if(old.has(String(item.id)))await UCAPI.updatePromotion(item.id,item);else await UCAPI.createPromotion(item);}
    ITEMS=(await UCAPI.publicPromotions()).items||[];saveLocal(ITEMS);return ITEMS;
  };
  pullUsers=async()=>[];
  document.getElementById("enter").onclick=async()=>{try{const d=await UCAPI.login(document.getElementById("login").value.trim(),document.getElementById("pass").value);await ucRequirePasswordChange(d.user);USER=((d.user.last||"")+" "+(d.user.first||"")).trim()||d.user.login;await openApp();}catch(e){alert(e.message)}};
  document.getElementById("out").onclick=async()=>{await UCAPI.logout();location.reload()};
})();
