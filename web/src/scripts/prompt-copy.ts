/** Bound clipboard feedback: a permission prompt can leave writeText pending indefinitely. */
export function bindPromptCopy(area:HTMLTextAreaElement,copy:HTMLButtonElement,notice:HTMLElement,isCurrent:()=>boolean,write:(value:string)=>Promise<void>=value=>navigator.clipboard.writeText(value),timeoutMs=3000){
 let disposed=false,busy=false,attempt=0,timer:ReturnType<typeof setTimeout>|undefined;
 const clearTimer=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
 const valid=(id:number)=>!disposed&&id===attempt&&isCurrent();
 copy.onclick=()=>{
  if(disposed||busy||!isCurrent())return;
  busy=true;copy.disabled=true;notice.textContent='Copying prompt…';const id=++attempt;
  const finish=(success:boolean)=>{
   if(id!==attempt)return;
   clearTimer();busy=false;
   if(!valid(id))return;
   // Invalidate the pending clipboard promise after a timeout or settlement.
   attempt++;copy.disabled=false;
   if(success)notice.textContent='Prompt copied. Paste it into your authorized agent.';
   else{area.focus();area.select();notice.textContent='Could not confirm the copy. The prompt is selected; copy it manually (Ctrl+C or Command+C).';}
  };
  timer=setTimeout(()=>finish(false),timeoutMs);
  try{void write(area.value).then(()=>finish(true),()=>finish(false));}catch{finish(false);}
 };
 return ()=>{disposed=true;attempt++;busy=false;clearTimer();copy.onclick=null;};
}
