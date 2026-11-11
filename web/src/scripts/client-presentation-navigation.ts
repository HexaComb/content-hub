import {clientPresentationPagePath,presentationPageLabels,type ClientPresentationRoute,type PresentationPlugin} from './client-presentation-state.ts';
/** Only server-authorized pages are offered. Month and exact preview remain unchanged. */
export function renderPresentationNavigation(root:HTMLElement,route:ClientPresentationRoute,pages:PresentationPlugin[],isCurrent:()=>boolean,onSelect:(plugin:PresentationPlugin)=>void){
 root.replaceChildren();root.hidden=!pages.length;
 for(const plugin of pages){
  const link=document.createElement('a');link.textContent=presentationPageLabels[plugin];link.href=clientPresentationPagePath({...route,plugin});
  if(plugin===route.plugin)link.setAttribute('aria-current','page');
  link.addEventListener('click',event=>{
   // Keep open-in-new-tab and keyboard/browser link behavior intact.
   if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.defaultPrevented)return;
   event.preventDefault();if(isCurrent()&&plugin!==route.plugin)onSelect(plugin);
  });root.append(link);
 }
}
